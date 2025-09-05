<script lang="ts">
  import { onMount } from 'svelte';
  import { joinRoom } from 'trystero/torrent';
  import { get } from 'svelte/store';
  import { getAllRecords, saveRecord, deleteRecord } from './db.js';
  import { sha256, bytesToHex } from './secp256k1.js';
  import { moderateRecord } from './moderation.js';
  import Ui from './UI.svelte';
  
  // --- Stores ---
  import { recordStore, merkleRoot } from './stores'; // Holds our local records and Merkle root
  import RecordGenerator from './RecordGenerator.svelte';

  // --- Stats ---
  let statRecordsSent = 0;           // Total number of records we sent to peers
  let statReceivedRecords = 0;       // Total number of records received from peers
  let statSubtreesExchanged = 0;     // Tracks Merkle subtrees exchanged (used by UI)
  let peerTraffic: Record<string, { sent: number; recv: number }> = {}; // Tracks sent/received per peer
  const lastActivity: Record<string, number> = {}; // Timestamp of last activity per peer
  const IDLE_TIMEOUT = 5000;         // Timeout to consider a peer idle

  const config = { appId: 'simpleSync' };
  const room = joinRoom(config, 'simpleRoom'); // Join a P2P room via Trystero

  let sendRootHash, getRootHash, sendRecords, getRecords; // Actions for syncing

  // --- Helper Functions ---

  // Initialize peer tracking
  function initPeer(peerId: string) {
    if (!peerTraffic[peerId]) peerTraffic[peerId] = { sent: 0, recv: 0 };
  }

  // Compute a simple Merkle-like root hash for the given records
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

  // Process incoming record: moderate, store locally, update Merkle root
  async function processRecord(uuid: string, record: any) {
    const approved = await moderateRecord(record); // Step 1: Moderation check
    if (!approved) return false;

    recordStore.update(local => ({ ...local, [uuid]: record })); // Step 2: Store locally
    await saveRecord(uuid, record);                               // Step 3: Persist in IndexedDB
    merkleRoot.set(computeRootHash(get(recordStore)));            // Step 4: Update Merkle root

    return true;
  }

  // --- Main P2P Sync Workflow ---
  onMount(async () => {
    // Step 1: Create P2P actions for syncing root hashes and full records
    [sendRootHash, getRootHash] = room.makeAction('rootHash');
    [sendRecords, getRecords] = room.makeAction('fullRecords');

    // Step 2: Load persisted records from local storage and update Merkle root
    const persisted = await getAllRecords();
    recordStore.set(persisted);
    merkleRoot.set(computeRootHash(persisted));

    // Step 3: Handle new peers joining the room
    room.onPeerJoin(peerId => {
      initPeer(peerId); // Track this peer
      sendRootHash(computeRootHash(get(recordStore)), peerId); // Send our current root hash
    });

    room.onPeerLeave(peerId => {
    console.log(`Peer ${peerId} left, cleaning up`);
    delete peerTraffic[peerId];
    delete lastActivity[peerId];
    // Also remove any per-peer buffers, Merkle caches, pending requests, etc.
    });

    // Step 4: Handle receiving a peer's root hash
    getRootHash(async (peerRootHash, peerId) => {
      initPeer(peerId);
      peerTraffic[peerId].recv++; // Increment received stats

      const ourRecords = get(recordStore);
      const ourRootHash = computeRootHash(ourRecords);

      // If hashes differ, send all our records to the peer
      if (peerRootHash !== ourRootHash) {
        sendRecords(ourRecords, peerId);
        const sentCount = Object.keys(ourRecords).length;
        peerTraffic[peerId].sent += sentCount;
        statRecordsSent += sentCount;
      }
    });

    // Step 5: Handle receiving full records from a peer
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

      if (processedCount > 0) sendRootHash(computeRootHash(get(recordStore))); // Update peers if changes
      lastActivity[peerId] = Date.now(); // Track last activity timestamp
    });

    // Step 6: Periodic check for idle peers
    setInterval(() => {
      const now = Date.now();
      for (const peerId in lastActivity) {
        if (now - lastActivity[peerId] > IDLE_TIMEOUT) {
          delete lastActivity[peerId]; // Remove idle peer
          sendRootHash(computeRootHash(get(recordStore)), peerId); // Ping to keep sync
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

  <!-- UI shows live stats -->
  <Ui
    {statReceivedRecords}
    {statSubtreesExchanged}
    {statRecordsSent}
    {peerTraffic}
  />
  
  <!-- Generates new records locally for testing -->
  <RecordGenerator />
</main>
