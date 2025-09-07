<script lang="ts">
  import { merkleRoot, hashMapStore } from './stores';
  import { getAllRecords, saveRecordsBatch, clearDatabase } from './db';
  import { onMount, createEventDispatcher } from 'svelte';
  import { get } from 'svelte/store';
  import { getMerkleTree } from './merkleTree.js';
  
  const dispatch = createEventDispatcher();

  // --- UI sync stats ---
  export let statReceivedRecords = 0;
  export let statSubtreesExchanged = 0;
  export let statRecordsSent = 0;
  export let statRootHashesSent = 0;
  export let statRootHashesReceived = 0;
  export let peerTraffic: Record<
    string,
    {
      sent: { rootHashes: number; subtrees: number; records: number },
      recv: { rootHashes: number; subtrees: number; records: number }
    }
  > = {};

  // Additional props needed for handleSendRootHash
  export let sendRootHashAction: (data: { merkleRoot: string }, peerId: string) => void;

  // Derive peers online
  $: peersOnline = Object.keys(peerTraffic || {}).length;

  // Local state for full records (loaded from IndexedDB)
  let fullRecords: Record<string, any> = {};

  // Record viewer state
  let pageSize = 50;
  let currentPage = 1;
  let expanded: Record<string, boolean> = {};

  // Generate records state
  let generateCount = 1;
  let isGenerating = false;

  // Load full records from IndexedDB when component mounts
  onMount(async () => {
    fullRecords = await getAllRecords();
  });

  // Function to refresh records from IndexedDB
  async function refreshRecords() {
    fullRecords = await getAllRecords();
  }

  // Function to reset all stats
  function resetStats() {
    dispatch('resetStats');
  }

  // Handle manual send roothash event
  async function handleSendRootHash() {
    const localHashes = get(hashMapStore);
    const localMerkleRoot = await getMerkleTree(localHashes);
    
    // Send root hash to all connected peers
    const connectedPeers = Object.keys(peerTraffic);
    if (connectedPeers.length === 0) {
      console.log('[peerset.DB] No peers connected to send root hash to');
      return;
    }
    
    console.log(`[peerset.DB] Manually sending root hash to ${connectedPeers.length} peer(s)`);
    
    for (const peerId of connectedPeers) {
      try {
        sendRootHashAction({ merkleRoot: localMerkleRoot.hash }, peerId);
        peerTraffic[peerId].sent.rootHashes++;
        statRootHashesSent++;
      } catch (error) {
        console.error(`[peerset.DB] Error sending root hash to peer ${peerId}:`, error);
      }
    }
    
    // Trigger reactivity by dispatching update event to parent
    dispatch('updatePeerTraffic', { peerTraffic, statRootHashesSent });
  }

  // Function to manually send root hash (wrapper for button click)
  function sendRootHash() {
    handleSendRootHash();
  }

  // Function to reset the database (like F5 refresh)
  async function resetDatabase() {
    
      try {
        // Clear the IndexedDB
        await clearDatabase();
        
        // Reset the stores
        hashMapStore.set({});
        merkleRoot.set('');
        
        // Clear local state
        fullRecords = {};
        
        
      } catch (error) {
        console.error('Error resetting database:', error);
        alert('Error resetting database: ' + error.message);
      }
    
  }

  // --- Random helpers for record generation ---
  const randomString = (len = 8) =>
    Array.from(crypto.getRandomValues(new Uint8Array(len)))
      .map((x) => (x % 36).toString(36))
      .join("");

  const randomNumber = (min, max) =>
    Math.random() * (max - min) + min;

  // --- Hash function ---
  async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // Function to generate records
  async function generateRecords() {
    if (isGenerating) return; // Prevent multiple simultaneous generations
    
    isGenerating = true;
    try {
      const recordsBatch = {};
      const hashUpdates = {};
      
      // Generate all records first
      for (let i = 0; i < generateCount; i++) {
        const record = {
          uuid: crypto.randomUUID(), // used as IndexedDB key
          created_at: Date.now(),
          bucket: randomString(6),
          author: {
            npub: "npub_" + randomString(16)
          },
          content: {
            text: "Random content " + randomString(6),
            link: "https://example.com/" + randomString(4)
          },
          geo: {
            latitude: randomNumber(-90, 90),
            longitude: randomNumber(-180, 180)
          },
          integrity: {
            hash: "",
            signature: "sig_" + randomString(32)
          }
        };

        // build hash from all data except integrity
        const hashInput = JSON.stringify({
          uuid: record.uuid,
          created_at: record.created_at,
          bucket: record.bucket,
          author: record.author,
          content: record.content,
          geo: record.geo
        });

        record.integrity.hash = await sha256(hashInput);
        
        // Add to batch
        recordsBatch[record.uuid] = record;
        hashUpdates[record.uuid] = record.integrity.hash;
      }
      
      // Batch save all records
      await saveRecordsBatch(recordsBatch);
      
      // Batch update hash map store
      hashMapStore.update(local => ({
        ...local,
        ...hashUpdates
      }));
      
      
      // Refresh records to show the new ones
      await refreshRecords();
    } finally {
      isGenerating = false;
    }
  }


  // Reactive statement to refresh records when hashMapStore changes
  $: if ($hashMapStore) {
    refreshRecords();
  }

  // Derive paged records from fullRecords
  $: pagedRecords = (() => {
    const records = Object.values(fullRecords || {}).sort((a, b) => {
      const aCreated =
        a.createdAt ||
        (a.created_at ? new Date(a.created_at).toISOString() : '') ||
        '';
      const bCreated =
        b.createdAt ||
        (b.created_at ? new Date(b.created_at).toISOString() : '') ||
        '';
      return aCreated.localeCompare(bCreated);
    });
    const start = (currentPage - 1) * pageSize;
    return records.slice(start, start + pageSize);
  })();
</script>

<main>
  <div style="margin:0; padding:0; width: 100%; height: 100%;">
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;">
      <h3 style="margin: 0 0 8px;">Sync Stats</h3>
      <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; width: 100%; max-width: 600px;">
        <button on:click={refreshRecords} style="width: 100%; padding: 10px 16px; border: 1px solid #007bff; border-radius: 4px; background: #007bff; color: white; cursor: pointer; font-size: 14px;">
          Refresh Records
        </button>
        <button on:click={resetStats} style="width: 100%; padding: 10px 16px; border: 1px solid #dc3545; border-radius: 4px; background: #dc3545; color: white; cursor: pointer; font-size: 14px;">
          Reset Stats
        </button>
        <button on:click={sendRootHash} style="width: 100%; padding: 10px 16px; border: 1px solid #6f42c1; border-radius: 4px; background: #6f42c1; color: white; cursor: pointer; font-size: 14px;">
          Send Root Hash
        </button>
        <button on:click={resetDatabase} style="width: 100%; padding: 10px 16px; border: 1px solid #e74c3c; border-radius: 4px; background: #e74c3c; color: white; cursor: pointer; font-size: 14px;">
          Reset Database
        </button>
        
        <!-- Record generation section -->
        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
          <div style="font-size: 14px; font-weight: bold; text-align: center;">Generate Records</div>
          <div style="display: flex; justify-content: center; align-items: center; gap: 8px;">
            <label for="generateCountInput" style="font-size: 14px;">Count:</label>
            <input 
              id="generateCountInput" 
              type="number" 
              min="1" 
              max="100000" 
              step="1" 
              bind:value={generateCount} 
              style="width: 120px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; text-align: center;"
            />
          </div>
          <button 
            on:click={generateRecords} 
            disabled={isGenerating}
            style="width: 100%; padding: 10px 16px; border: 1px solid {isGenerating ? '#6c757d' : '#28a745'}; border-radius: 4px; background: {isGenerating ? '#6c757d' : '#28a745'}; color: white; cursor: {isGenerating ? 'not-allowed' : 'pointer'}; font-size: 14px; font-weight: bold;"
          >
            {isGenerating ? 'Generating...' : `Generate ${generateCount} Records`}
          </button>
        </div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(3, minmax(150px, 1fr)); gap: 8px;">
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; background-color:green; padding: 8px; border: 1px solid #ddd; border-radius: 6px;">
        Peers online: <strong>{peersOnline}</strong>
      </div>
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;background-color:green; padding: 8px; border: 1px solid #ddd; border-radius: 6px;">
        Total records: <strong>{Object.keys(fullRecords || {}).length}</strong>
      </div>
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;background-color:green; padding: 8px; border: 1px solid #ddd; border-radius: 6px;">
        Root hash: <strong>{$merkleRoot.substring(0, 9)}</strong> 
      </div>
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;background-color:green; padding: 8px; border: 1px solid #ddd; border-radius: 6px;">
        Records received: <strong>{statReceivedRecords}</strong>
      </div>
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;background-color:green; padding: 8px; border: 1px solid #ddd; border-radius: 6px;">
        Records sent: <strong>{statRecordsSent}</strong>
      </div>
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;background-color:green; padding: 8px; border: 1px solid #ddd; border-radius: 6px;">
        Subtrees exchanged: <strong>{statSubtreesExchanged}</strong>
      </div>
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;background-color:green; padding: 8px; border: 1px solid #ddd; border-radius: 6px;">
        Root hashes sent: <strong>{statRootHashesSent}</strong>
      </div>
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;background-color:green; padding: 8px; border: 1px solid #ddd; border-radius: 6px;">
        Root hashes received: <strong>{statRootHashesReceived}</strong>
      </div>
    </div>
  
    <h3 style="display: flex; flex-direction: column; align-items: center; justify-content: center; margin: 16px 0 8px;">Per-peer Traffic</h3>
    {#if Object.keys(peerTraffic || {}).length === 0}
      <div style="color: #666;">No peer traffic yet.</div>
    {:else}
      <div style="background-color:orange; overflow: auto; border: 1px solid #eee; border-radius: 6px;">
        <table style="width: 100%;font-size: 13px;">
          <thead>
            <tr style="background: #fafafa; color: #000;">
              <th>Peer ID</th>
              <th>Recv Sub</th>
              <th>Sent: Sub</th>
              <th>Rec: Rec</th>
              <th>Sent: Rec</th>
            </tr>
          </thead>
          <tbody>
            {#each Object.keys(peerTraffic).sort() as pid}
              <tr>
                <td style="display: flex; align-items: center; justify-content: center;">{pid}</td>
                <td>{peerTraffic[pid].recv.subtrees}</td>
                <td>{peerTraffic[pid].sent.subtrees}</td>
                <td>{peerTraffic[pid].recv.records}</td>
                <td>{peerTraffic[pid].sent.records}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    <h3 style="display: flex; align-items: center; justify-content: center; margin: 16px 0 8px;">Record Viewer</h3>
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; margin-bottom: 8px;">
      <label for="pageSizeInput">Page size:</label>
      <input id="pageSizeInput" type="number" min="10" max="500" step="10" bind:value={pageSize} on:change={() => { currentPage = 1; }} style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 80px; padding: 6px; border: 1px solid #ccc; border-radius: 4px;" />
    </div>

    {#if Object.keys(fullRecords || {}).length > 0}
      {#key currentPage + ':' + pageSize}
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; margin-bottom: 8px;">
          <span>Total records: <strong>{Object.keys(fullRecords).length}</strong></span>
        </div>
        <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
          <button on:click={() => currentPage = Math.max(1, currentPage - 1)} disabled={currentPage === 1} style="padding: 6px 10px; border: 1px solid #999; border-radius: 4px; background: #f7f7f7; cursor: pointer;">Prev</button>
          <span>Page <strong>{currentPage}</strong> of <strong>{Math.max(1, Math.ceil(Object.keys(fullRecords).length / pageSize))}</strong></span>
          <button on:click={() => currentPage = Math.min(Math.ceil(Object.keys(fullRecords).length / pageSize), currentPage + 1)} disabled={currentPage >= Math.ceil(Object.keys(fullRecords).length / pageSize)} style="padding: 6px 10px; border: 1px solid #999; border-radius: 4px; background: #f7f7f7; cursor: pointer;">Next</button>
        </div>
        <div style="background-color:lightblue; max-height: 420px; overflow: auto; border: 1px solid #eee; border-radius: 6px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <thead>
              <tr style="background: #f0f0f0; color: #000;">
                <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">Record ID</th>
                <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">Created</th>
                <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">Creator</th>
                <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">Text</th>
                <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">Link</th>
                <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">Details</th>
              </tr>
            </thead>
            <tbody>
              {#each pagedRecords as record}
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #f2f2f2; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;">{record.uuid}</td>
                  <td style="padding: 8px; border-bottom: 1px solid #f2f2f2;">{record.createdAt}</td>
                  <td style="padding: 8px; border-bottom: 1px solid #f2f2f2;">{record.creator_npub}</td>
                  <td style="padding: 8px; border-bottom: 1px solid #f2f2f2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px;">{record.text}</td>
                  <td style="padding: 8px; border-bottom: 1px solid #f2f2f2; max-width: 180px; overflow: hidden; text-overflow: ellipsis;">
                    {#if record.link}
                      <a href={record.link} target="_blank" rel="noopener noreferrer">{record.link}</a>
                    {/if}
                  </td>
                  <td style="padding: 8px; border-bottom: 1px solid #f2f2f2;">
                    <button on:click={() => (expanded[record.uuid] = !expanded[record.uuid])} style="padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; background: #fafafa; cursor: pointer;">
                      {expanded[record.uuid] ? 'Hide' : 'Show'}
                    </button>
                  </td>
                </tr>
                {#if expanded[record.uuid]}
                  <tr>
                    <td colspan="6" style="padding: 8px 8px 12px; border-bottom: 1px solid #f2f2f2; color: inherit; font-size: 12px;">
                      <div><strong>Timestamp</strong>: {record.timestamp}</div>
                      <div><strong>Lat</strong>: {record.latitude} · <strong>Lon</strong>: {record.longitude}</div>
                      <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; word-break: break-all;">
                        <div><strong>Hash</strong>: {record.integrity?.hash || record.hash || 'N/A'}</div>
                        <div><strong>Signature</strong>: {record.signature}</div>
                      </div>
                    </td>
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
        </div>
      {/key}
    {:else}
      <div style="color: #666;">No records yet.</div>
    {/if}
  </div>
</main>
