<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { joinRoom, selfId } from 'trystero/torrent';
  import { bucketStore, uuidStore, recordStore } from './tempstores.js';
  import { getAllRecords, saveRecords, deleteRecord } from './db.js';
  import { computeBucketHash } from './secp256k1.js';
  import { TOTAL_BUCKETS, getBucketForDate, isBucketActive, getActiveBuckets } from './bucketUtils.js';
  
  // --- Trystero config ---
  const config = { appId: 'testpeer' };
  const room = joinRoom(config, 'testroom741369');
  
  // --- Actions ---
  let sendBucketList, getBucketList;
  let sendBucketDiff, getBucketDiff;
  let sendUUIDs, getUUIDs;
  let sendRequestRecords, getRequestRecords;
  let sendRecords, getRecords;
  
  // --- Idle detection for bucket refresh ---
  const IDLE_TIMEOUT = 5000; // ms
  const lastActivity: Record<string, number> = {};
  
  // --- On mount, setup Trystero and sync workflow ---
  onMount(() => {
    // 0️⃣ Initialize Trystero actions
    [sendBucketList, getBucketList] = room.makeAction('bucketList');
    [sendBucketDiff, getBucketDiff] = room.makeAction('bucketDiff');
    [sendUUIDs, getUUIDs] = room.makeAction('bucketUUIDs');
    [sendRequestRecords, getRequestRecords] = room.makeAction('requestRecords');
    [sendRecords, getRecords] = room.makeAction('sendRecords');
  
    // 1️⃣ Send bucket list on every new peer join (only to that peer)
    room.onPeerJoin(peerId => {
      bucketStore.subscribe(localBuckets => {
        sendBucketList(localBuckets, peerId);
        console.log('Sent initial bucket list to', peerId);
      })();
    });
  
    // 2️⃣ Receive peer's bucket list → reply with our differing hashes
    getBucketList((peerBuckets, peerId) => {
      bucketStore.subscribe(localBuckets => {
        const differing: Record<string, string> = {};
        for (let bucketId in peerBuckets) {
          if (localBuckets[bucketId] !== peerBuckets[bucketId]) differing[bucketId] = localBuckets[bucketId];
        }
        if (Object.keys(differing).length > 0) sendBucketDiff(differing, peerId);
      })();
    });
  
    // 3️⃣ Receive differing hashes → send UUIDs of local records in those buckets
    getBucketDiff((differingHashes, peerId) => {
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
          if (missingUUIDs.length > 0) sendRequestRecords(missingUUIDs, peerId);
        })();
      })();
    });
  
    // 5️⃣ Receive record requests (UUIDs) → send full records
    getRequestRecords((uuids, peerId) => {
      recordStore.subscribe(localRecords => {
        const payload: Record<string, any> = {};
        for (const id of uuids) {
          if (localRecords[id]) payload[id] = localRecords[id];
        }
        if (Object.keys(payload).length > 0) sendRecords(payload, peerId);
      })();
    });

    // 6️⃣ Receive full records → update stores + IndexedDB + lastActivity
    getRecords(async (records, peerId) => {
      // Update in-memory recordStore
      recordStore.update(localRecords => {
        const updated = { ...localRecords } as Record<string, any>;
        for (let uuid in records) updated[uuid] = records[uuid];
        return updated as any;
      });
  
      // Update UUIDs per bucket
      uuidStore.update(localUUIDs => {
        const updated = { ...localUUIDs } as Record<string, string[]>;
        for (let uuid in records) {
          const bucketId = records[uuid].bucketId;
          const list = updated[bucketId] ? [...updated[bucketId]] : [];
          if (!list.includes(uuid)) list.push(uuid);
          updated[bucketId] = list;
        }
        return updated as any;
      });
  
      // Persist to IndexedDB
      await saveRecords(records);
  
      // Update last activity timestamp for idle detection
      lastActivity[peerId] = Date.now();
    });
  
    // 7️⃣ Idle peer check → recompute bucket hashes (rolling window) → broadcast if changed
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
            const active = getActiveBuckets();
            for (const bucketId of active) {
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
  
    // 8️⃣ Prune old records every 5 minutes based on inactive buckets
    const pruneOldRecords = async () => {
      const activeSet = new Set(getActiveBuckets());
      const allRecords = await getAllRecords();
  
      for (let record of allRecords) {
        if (!activeSet.has(record.bucketId)) {
          await deleteRecord(record.uuid);
  
          recordStore.update(r => {
            const updated = { ...r } as any;
            delete updated[record.uuid];
            return updated;
          });
  
          uuidStore.update(u => {
            const list = u[record.bucketId] || [];
            const filtered = list.filter(id => id !== record.uuid);
            const updated = { ...u } as Record<string, string[]>;
            if (filtered.length > 0) updated[record.bucketId] = filtered; else delete updated[record.bucketId];
            return updated as any;
          });
        }
      }
    };
    setInterval(pruneOldRecords, 5*60*1000); // every 5 minutes
  });
  </script>
  