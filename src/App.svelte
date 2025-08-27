<script lang="ts">
  import { onMount } from 'svelte';
  import {joinRoom} from 'trystero'
  import { bucketStore, uuidStore, recordStore } from './bucketStore.js';
  import { get } from 'svelte/store';
  
  const config = {appId: 'testpeer'};
  const room = joinRoom(config, 'testroom741369');

  let sendBucketList, getBucketList;
  let sendUUIDs, getUUIDs;
  let sendRecords, getRecords;
  let sendmessage, getmessage;
  
  onMount(() => {
    // Actions
    [sendBucketList, getBucketList] = room.makeAction('bucketList');
    [sendUUIDs, getUUIDs] = room.makeAction('bucketUUIDs');
    [sendRecords, getRecords] = room.makeAction('fullRecords');
    [sendmessage, getmessage] = room.makeAction('message');
  
    // -----------------------------
    // 0️⃣ On every new peer join → send our bucket list ONLY to that peer
    room.onPeerJoin((peerId) => {
      bucketStore.subscribe(localBuckets => {
        sendmessage('HELLO ' + peerId, peerId);
        sendBucketList(localBuckets, peerId);
        console.log('Sent initial bucket list to new peer', peerId);
      })();
    });
    
    getmessage((message, peerId) => {
      console.log('Received message from peer:', peerId, 'Message: ', message);
      console.log('Hash list:', get(bucketStore));
      console.log('UUID list:', get(uuidStore));
      console.log('Record list:', get(recordStore));
    });
    // -----------------------------
    // 1️⃣ Receive bucket list from peer → send back differing hashes automatically
    getBucketList((peerBuckets, peerId) => {
      bucketStore.subscribe(localBuckets => {
        const differingHashes = {};
        for (let bucketId in peerBuckets) {
          if (localBuckets[bucketId] !== peerBuckets[bucketId]) {
            differingHashes[bucketId] = localBuckets[bucketId];
          }
        }
        if (Object.keys(differingHashes).length > 0) {
          sendBucketList(differingHashes, peerId);
        }
      })();
    });
  
    // -----------------------------
    // 2️⃣ Receive differing hashes → send UUIDs for those buckets
    getBucketList((differingHashes, peerId) => {
      uuidStore.subscribe(localUUIDs => {
        const uuidsToSend = {};
        for (let bucketId in differingHashes) {
          if (localUUIDs[bucketId]) {
            uuidsToSend[bucketId] = localUUIDs[bucketId];
          }
        }
        if (Object.keys(uuidsToSend).length > 0) {
          sendUUIDs(uuidsToSend, peerId);
        }
      })();
    });
  
    // -----------------------------
    // 3️⃣ Receive UUIDs → check missing → request full records
    getUUIDs((peerUUIDs, peerId) => {
      uuidStore.subscribe(localUUIDs => {
        recordStore.subscribe(localRecords => {
          const missingUUIDs = [];
          for (let bucketId in peerUUIDs) {
            const uuids = peerUUIDs[bucketId];
            for (let uuid of uuids) {
              const allLocal = (localUUIDs[bucketId] || []).concat(Object.keys(localRecords));
              if (!allLocal.includes(uuid)) {
                missingUUIDs.push(uuid);
              }
            }
          }
          if (missingUUIDs.length > 0) {
            sendRecords(missingUUIDs, peerId);
          }
        })();
      })();
    });
  
    // -----------------------------
    // 4️⃣ Receive full records → store locally
    getRecords((records, peerId) => {
      recordStore.update(localRecords => {
        for (let uuid in records) {
          localRecords[uuid] = records[uuid];
        }
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
    });
  });
  </script>
  