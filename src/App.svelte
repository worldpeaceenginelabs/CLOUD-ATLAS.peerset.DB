<script lang="ts">
  import { onMount } from 'svelte';
  import { joinRoom } from 'trystero/torrent';
  import { get } from 'svelte/store';
  import { getAllRecords, saveRecord, deleteRecord } from './db.js';
  import { sha256, bytesToHex } from './secp256k1.js';
  import { moderateRecord } from './moderation.js';
  import Ui from './UI.svelte';
  
  // --- Stores ---
  import { recordStore, merkleRoot } from './stores';
  import RecordGenerator from './RecordGenerator.svelte';

  // --- Stats ---
  let statRecordsSent = 0;
  let statReceivedRecords = 0;
  let statSubtreesExchanged = 0; // still required by Ui
  let peerTraffic: Record<string, { sent: number; recv: number }> = {};
  const lastActivity: Record<string, number> = {};
  const IDLE_TIMEOUT = 5000;

  const config = { appId: 'simpleSync' };
  const room = joinRoom(config, 'simpleRoom');
  let sendRootHash, getRootHash, sendRecords, getRecords;

  function initPeer(peerId: string) {
    if (!peerTraffic[peerId]) peerTraffic[peerId] = { sent: 0, recv: 0 };
  }

  function computeRootHash(records: Record<string, any>): string {
    const keys = Object.keys(records).sort();
    const concat = keys.map(k => k + records[k].integrity.hash).join('|');
    let hash = 0;
    for (let i = 0; i < concat.length; i++) {
      const char = concat.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16).padStart(8, '0');
  }

  async function processRecord(uuid: string, record: any) {
    const approved = await moderateRecord(record);
    if (!approved) return false;
    recordStore.update(local => ({ ...local, [uuid]: record }));
    await saveRecord(uuid, record);
    merkleRoot.set(computeRootHash(get(recordStore)));
    return true;
  }

  onMount(async () => {
    [sendRootHash, getRootHash] = room.makeAction('rootHash');
    [sendRecords, getRecords] = room.makeAction('fullRecords');

    const persisted = await getAllRecords();
    recordStore.set(persisted);
    merkleRoot.set(computeRootHash(persisted));

    room.onPeerJoin(peerId => {
      initPeer(peerId);
      sendRootHash(computeRootHash(get(recordStore)), peerId);
    });

    getRootHash(async (peerRootHash, peerId) => {
      initPeer(peerId);
      peerTraffic[peerId].recv++;

      const ourRecords = get(recordStore);
      const ourRootHash = computeRootHash(ourRecords);

      if (peerRootHash !== ourRootHash) {
        sendRecords(ourRecords, peerId);
        const sentCount = Object.keys(ourRecords).length;
        peerTraffic[peerId].sent += sentCount;
        statRecordsSent += sentCount;
      }
    });

    getRecords(async (records: Record<string, any>, peerId) => {
      initPeer(peerId);
      const incomingCount = Object.keys(records).length;
      statReceivedRecords += incomingCount;
      peerTraffic[peerId].recv += incomingCount;

      let processedCount = 0;
      for (const [uuid, record] of Object.entries(records)) {
        if (await processRecord(uuid, record)) processedCount++;
      }

      console.log(`Processed ${processedCount}/${incomingCount} records from ${peerId}`);

      if (processedCount > 0) sendRootHash(computeRootHash(get(recordStore)));
      lastActivity[peerId] = Date.now();
    });

    setInterval(() => {
      const now = Date.now();
      for (const peerId in lastActivity) {
        if (now - lastActivity[peerId] > IDLE_TIMEOUT) {
          delete lastActivity[peerId];
          sendRootHash(computeRootHash(get(recordStore)), peerId);
        }
      }
    }, 1000);
  });
</script>

<main style="margin:0; padding:0; width: 95%; height: 95%;">
  <div style="margin:0; padding:0; background-color:dimgray;">
    <a href="https://github.com/worldpeaceenginelabs/CLOUD-ATLAS.peerset.DB">
      <img height="50" width="50" src="github.jpg">
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
