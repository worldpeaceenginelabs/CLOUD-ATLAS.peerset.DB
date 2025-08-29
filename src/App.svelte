<script lang="ts">
  import { onMount } from 'svelte';
  import { joinRoom, selfId } from 'trystero/torrent';
  import { bucketStore, uuidStore, recordStore } from './BucketStore.js';
  import { addRecord } from './addRecord.js';
  import { getAllRecords, saveRecords, deleteRecord } from './db.js';
  import { computeBucketHash } from './hash.js';
  import { TOTAL_BUCKETS, getBucketForDate, isBucketActive } from './bucketUtils.js';
  
  const config = { appId: 'testpeer' };
  const room = joinRoom(config, 'testroom741369');
  
  let sendBucketList, getBucketList;
  let sendUUIDs, getUUIDs;
  let sendRecords, getRecords;
  
  const IDLE_TIMEOUT = 5000; // ms
  const lastActivity = {}; // peerId -> timestamp
  
  onMount(() => {
    // --- 0️⃣ Initialize Trystero actions ---
    [sendBucketList, getBucketList] = room.makeAction('bucketList');
    [sendUUIDs, getUUIDs] = room.makeAction('bucketUUIDs');
    [sendRecords, getRecords] = room.makeAction('fullRecords');
  
    // --- 1️⃣ Send bucket list on new peer join ---
    room.onPeerJoin(peerId => {
      bucketStore.subscribe(localBuckets => {
        sendBucketList(localBuckets, peerId);
        console.log('Sent initial bucket list to', peerId);
      })();
    });
  
    // --- 2️⃣ Receive bucket list → send differing hashes ---
    getBucketList((peerBuckets, peerId) => {
      bucketStore.subscribe(localBuckets => {
        const differing = {};
        for (let bucketId in peerBuckets) {
          if (localBuckets[bucketId] !== peerBuckets[bucketId]) differing[bucketId] = localBuckets[bucketId];
        }
        if (Object.keys(differing).length > 0) sendBucketList(differing, peerId);
      })();
    });
  
    // --- 3️⃣ Receive differing hashes → send UUIDs ---
    getBucketList((differingHashes, peerId) => {
      uuidStore.subscribe(localUUIDs => {
        const uuidsToSend = {};
        for (let bucketId in differingHashes) {
          if (localUUIDs[bucketId]) uuidsToSend[bucketId] = localUUIDs[bucketId];
        }
        if (Object.keys(uuidsToSend).length > 0) sendUUIDs(uuidsToSend, peerId);
      })();
    });
  
    // --- 4️⃣ Receive UUIDs → request missing full records ---
    getUUIDs((peerUUIDs, peerId) => {
      uuidStore.subscribe(localUUIDs => {
        recordStore.subscribe(localRecords => {
          const missingUUIDs = [];
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
  
    // --- 5️⃣ Receive full records → store locally + IndexedDB + update lastActivity ---
    getRecords(async (records, peerId) => {
      recordStore.update(localRecords => {
        for (let uuid in records) localRecords[uuid] = records[uuid];
        return localRecords;
      });
  
      uuidStore.update(localUUIDs => {
        for (let uuid in records) {
          const bucketId = records[uuid].bucketId;
          if (!localUUIDs[bucketId]) localUUIDs[bucketId] = [];
          if (!localUUIDs[bucketId].includes(uuid)) localUUIDs[bucketId].push(uuid);
        }
        return localUUIDs;
      });
  
      await saveRecords(records);
  
      // Update last activity timestamp for idle detection
      lastActivity[peerId] = Date.now();
    });
  
    // --- 6️⃣ Check idle peers and broadcast updated bucket list if changed ---
    const checkIdlePeers = () => {
      const now = Date.now();
      for (let peerId in lastActivity) {
        if (now - lastActivity[peerId] > IDLE_TIMEOUT) {
          // Peer considered synced
          delete lastActivity[peerId];
  
          let bucketListChanged = false;
  
          // Recompute bucket hashes
          bucketStore.update(localBuckets => {
            const allRecords = Object.values(recordStore);
            const bucketMap = {};
  
            allRecords.forEach(r => {
              if (!bucketMap[r.bucketId]) bucketMap[r.bucketId] = [];
              bucketMap[r.bucketId].push(r.uuid);
            });
  
            const newBucketHashes = {};
            for (let i = 1; i <= TOTAL_BUCKETS; i++) {
              const bucketId = `day${i}`;
              newBucketHashes[bucketId] = computeBucketHash(bucketMap[bucketId]||[], 
                Object.fromEntries(allRecords.map(r => [r.uuid,r])));
              if (newBucketHashes[bucketId] !== localBuckets[bucketId]) bucketListChanged = true;
            }
  
            return newBucketHashes;
          });
  
          // Broadcast if changed
          if (bucketListChanged) {
          bucketStore.subscribe(localBuckets => {
          sendBucketList(localBuckets); // broadcast to all peers
            })();
          }
        }
      }
    };
  
    setInterval(checkIdlePeers, 1000);
  });
  </script>
  