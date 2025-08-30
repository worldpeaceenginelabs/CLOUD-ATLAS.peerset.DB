<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { joinRoom} from 'trystero/torrent';
  import { bucketStore, uuidStore, recordStore } from './tempstores.js';
  import UI from './UI.svelte';
  import { getAllRecords, saveRecords, deleteRecord } from './db.js';
  import { computeBucketHash } from './secp256k1.js';
  import { getActiveBuckets } from './bucketUtils.js';
  
   // 🔹 Track active peers in a Set
   let activePeers = new Set<string>();
  $: peersOnline = activePeers.size;


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

  // --- UI sync stats ---
  let statLocalRecords = 0;
  let statReceivedRecords = 0;
  let statBucketsExchanged = 0;
  let statUUIDsExchanged = 0;
  let statRecordsExchanged = 0;

  // --- Per-peer traffic stats ---
  type Traffic = { buckets: number; uuids: number; requests: number; records: number };
  type PeerTraffic = Record<string, { sent: Traffic; recv: Traffic }>;
  let peerTraffic: PeerTraffic = {};

  function ensurePeer(peerId: string) {
    if (!peerTraffic[peerId]) {
      peerTraffic[peerId] = {
        sent: { buckets: 0, uuids: 0, requests: 0, records: 0 },
        recv: { buckets: 0, uuids: 0, requests: 0, records: 0 }
      };
    }
  }
  function addPeerCount(peerId: string, dir: 'sent'|'recv', field: keyof Traffic, delta: number) {
    ensurePeer(peerId);
    // Replace object to keep Svelte reactive
    peerTraffic = {
      ...peerTraffic,
      [peerId]: {
        ...peerTraffic[peerId],
        [dir]: {
          ...peerTraffic[peerId][dir],
          [field]: peerTraffic[peerId][dir][field] + delta
        }
      }
    };
  }
  
  // --- On mount, setup Trystero and sync workflow ---
  onMount(() => {
    // 0️⃣ Initialize Trystero actions
    [sendBucketList, getBucketList] = room.makeAction('bucketList');
    [sendBucketDiff, getBucketDiff] = room.makeAction('bucketDiff');
    [sendUUIDs, getUUIDs] = room.makeAction('bucketUUIDs');
    [sendRequestRecords, getRequestRecords] = room.makeAction('reqRecs');
    [sendRecords, getRecords] = room.makeAction('sendRecords');
  
    // Initial bucket hash computation and broadcast
    const recomputeAndBroadcast = async () => {
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
      const current = get(bucketStore) as Record<string, string>;
      let changed = false;
      if (Object.keys(current).length !== Object.keys(newBucketHashes).length) changed = true;
      if (!changed) {
        for (const k in newBucketHashes) { if (newBucketHashes[k] !== current[k]) { changed = true; break; } }
      }
      if (changed) {
        bucketStore.set(newBucketHashes as any);
        sendBucketList(newBucketHashes);
        console.log('[init] Computed and broadcasted bucket hashes.');
      }
    };

    // Run once on mount
    recomputeAndBroadcast();

    // Debounced recompute when records change
    let recomputeTimer: any;
    recordStore.subscribe(() => {
      clearTimeout(recomputeTimer);
      recomputeTimer = setTimeout(recomputeAndBroadcast, 250);
    });

    // 1️⃣ Send bucket list on every new peer join (only to that peer)
    room.onPeerJoin(peerId => {
      activePeers.add(peerId);
    console.log('Peer joined:', peerId, 'Peers online:', activePeers.size);
      console.log('[1/8] Peer joined. Sending our bucket list.');
      bucketStore.subscribe(localBuckets => {
        sendBucketList(localBuckets, peerId);
        console.log('[1/8] Bucket list sent to peer', peerId);
        statBucketsExchanged += Object.keys((localBuckets as any) || {}).length;
        addPeerCount(peerId, 'sent', 'buckets', Object.keys((localBuckets as any) || {}).length);
      })();
    });

    room.onPeerLeave((peerId) => {
    activePeers.delete(peerId);
    console.log('Peer left:', peerId, 'Peers online:', activePeers.size);
    // optional: clean up traffic stats if you don’t want “ghost” peers in the table
    delete peerTraffic[peerId];
    peerTraffic = { ...peerTraffic }; // trigger reactivity
  });
  
    // 2️⃣ Receive peer's bucket list → reply with our differing hashes
    getBucketList((peerBuckets, peerId) => {
      console.log('[2/8] Received bucket list. Computing differences.');
      bucketStore.subscribe(localBuckets => {
        const differing: Record<string, string> = {};
        for (let bucketId in peerBuckets) {
          if (localBuckets[bucketId] !== peerBuckets[bucketId]) differing[bucketId] = localBuckets[bucketId];
        }
        if (Object.keys(differing).length > 0) {
          console.log('[3/8] Sending our differing bucket hashes.');
          sendBucketDiff(differing, peerId);
          addPeerCount(peerId, 'sent', 'buckets', Object.keys(differing).length);
        } else {
          console.log('[3/8] No differing hashes to send.');
        }
        statBucketsExchanged += Object.keys((peerBuckets as any) || {}).length;
        addPeerCount(peerId, 'recv', 'buckets', Object.keys((peerBuckets as any) || {}).length);
      })();
    });
  
    // 3️⃣ Receive differing hashes → send UUIDs of local records in those buckets
    getBucketDiff((differingHashes, peerId) => {
      console.log('[4/8] Received differing hashes. Preparing UUID lists.');
      uuidStore.subscribe(localUUIDs => {
        const uuidsToSend: Record<string, string[]> = {};
        for (let bucketId in differingHashes) {
          if (localUUIDs[bucketId]) uuidsToSend[bucketId] = localUUIDs[bucketId];
        }
        if (Object.keys(uuidsToSend).length > 0) {
          console.log('[5/8] Sending UUIDs for differing buckets.');
          sendUUIDs(uuidsToSend, peerId);
          addPeerCount(peerId, 'sent', 'uuids', (Object.values(uuidsToSend) as any[]).reduce((a: number, b: any) => a + ((b && b.length) || 0), 0));
        } else {
          console.log('[5/8] No UUIDs to send for differing buckets.');
        }
        statUUIDsExchanged += (Object.values(uuidsToSend) as any[]).reduce((a: number, b: any) => a + ((b && b.length) || 0), 0);
        addPeerCount(peerId, 'recv', 'buckets', Object.keys(differingHashes || {}).length);
      })();
    });
  
    // 4️⃣ Receive UUIDs → request missing full records
    getUUIDs((peerUUIDs, peerId) => {
      console.log('[6/8] Received UUIDs. Checking for missing records.');
      uuidStore.subscribe(localUUIDs => {
        recordStore.subscribe(localRecords => {
          const missingUUIDs: string[] = [];
          for (let bucketId in peerUUIDs) {
            for (let uuid of peerUUIDs[bucketId]) {
              const allLocal = (localUUIDs[bucketId]||[]).concat(Object.keys(localRecords));
              if (!allLocal.includes(uuid)) missingUUIDs.push(uuid);
            }
          }
          if (missingUUIDs.length > 0) {
            console.log('[7/8] Requesting missing full records.', missingUUIDs.length);
            sendRequestRecords(missingUUIDs, peerId);
            addPeerCount(peerId, 'sent', 'requests', missingUUIDs.length);
          } else {
            console.log('[7/8] No missing records to request.');
          }
          statUUIDsExchanged += (Object.values(peerUUIDs) as any[]).reduce((a: number, b: any) => a + ((b && b.length) || 0), 0);
          addPeerCount(peerId, 'recv', 'uuids', (Object.values(peerUUIDs) as any[]).reduce((a: number, b: any) => a + ((b && b.length) || 0), 0));
        })();
      })();
    });
  
    // 5️⃣ Receive record requests (UUIDs) → send full records
    getRequestRecords((uuids, peerId) => {
      console.log('[8/8] Peer requested records. Sending payload.');
      recordStore.subscribe(localRecords => {
        const payload: Record<string, any> = {};
        for (const id of uuids) {
          if (localRecords[id]) payload[id] = localRecords[id];
        }
        if (Object.keys(payload).length > 0) sendRecords(payload, peerId);
        statRecordsExchanged += Object.keys(payload).length;
        addPeerCount(peerId, 'recv', 'requests', uuids.length || 0);
        addPeerCount(peerId, 'sent', 'records', Object.keys(payload).length);
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

      // Update UI counters
      statReceivedRecords += Object.keys(records || {}).length;
      addPeerCount(peerId, 'recv', 'records', Object.keys(records || {}).length);
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
      console.log('[8/8] Prune start: scanning for records outside active window.', {
        activeBuckets: Array.from(activeSet).slice(0, 3).join(', ') + ' …',
        totalRecords: allRecords.length
      });

      let prunedCount = 0;
      for (let record of allRecords) {
        if (!activeSet.has(record.bucketId)) {
          console.log('[8/8] Prune remove:', record.uuid, 'from', record.bucketId);
          prunedCount++;
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
      console.log('[8/8] Prune complete:', { prunedCount, activeWindowSize: activeSet.size });
    };
    setInterval(pruneOldRecords, 5*60*1000); // every 5 minutes
  });
  </script>
  
  <UI
    {statReceivedRecords}
    {statBucketsExchanged}
    {statUUIDsExchanged}
    {statRecordsExchanged}
    {peerTraffic}
  />
  