<script lang="ts">
  import { merkleRoot, hashMapStore } from './stores';
  import { getAllRecords, saveRecordsBatch, clearDatabase } from './db';
  import { onMount, createEventDispatcher } from 'svelte';
  import { get } from 'svelte/store';
  import { getMerkleTree } from './merkleTree.js';
  import DataChannelView from './DataChannelView.svelte';
  
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
  
  export let p2pMessageData: Record<string, Array<{
    timestamp: string;
    type: 'sent' | 'received';
    channel: 'rootHash' | 'records' | 'subtree';
    data: any;
    size: number;
  }>> = {};

  // Additional props needed for handleSendRootHash
  export let sendRootHashAction: (data: { merkleRoot: string }, peerId: string) => void;
  export let currentMerkleRoot: string = '';

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
    console.log('Reset Stats button clicked');
    dispatch('resetStats');
  }

  // Handle manual send roothash event
  async function handleSendRootHash() {
    console.log('handleSendRootHash called');
    // Use the debounced merkle root (newest) instead of recalculating
    const localMerkleRootHash = get(merkleRoot);
    console.log('Local merkle root hash:', localMerkleRootHash);
    
    // Send root hash to all connected peers
    const connectedPeers = Object.keys(peerTraffic);
    console.log('Connected peers:', connectedPeers);
    if (connectedPeers.length === 0) {
      console.log('No connected peers, returning early');
      return;
    }
    
    // Create a copy of peerTraffic to modify
    const updatedPeerTraffic = { ...peerTraffic };
    let updatedStatRootHashesSent = statRootHashesSent;
    
    for (const peerId of connectedPeers) {
      try {
        console.log(`Sending root hash to peer: ${peerId}`);
        sendRootHashAction({ merkleRoot: localMerkleRootHash }, peerId);
        console.log(`Successfully sent root hash to peer: ${peerId}`);
        updatedPeerTraffic[peerId] = {
          ...updatedPeerTraffic[peerId],
          sent: {
            ...updatedPeerTraffic[peerId].sent,
            rootHashes: updatedPeerTraffic[peerId].sent.rootHashes + 1
          }
        };
        updatedStatRootHashesSent++;
      } catch (error) {
        console.error('Error sending root hash to peer:', peerId, error);
      }
    }
    
    // Trigger reactivity by dispatching update event to parent
    console.log('Dispatching updatePeerTraffic event');
    dispatch('updatePeerTraffic', { 
      peerTraffic: updatedPeerTraffic, 
      statRootHashesSent: updatedStatRootHashesSent 
    });
    console.log('handleSendRootHash completed');
  }

  // Function to manually send root hash (wrapper for button click)
  function sendRootHash() {
    console.log('Send Root Hash button clicked');
    console.log('sendRootHashAction prop:', sendRootHashAction);
    if (!sendRootHashAction) {
      console.error('sendRootHashAction is not defined!');
      return;
    }
    handleSendRootHash();
  }

  // Function to reset the database (like F5 refresh)
  async function resetDatabase() {
    console.log('Reset Database button clicked');
    try {
      console.log('Clearing database...');
      // Clear the IndexedDB
      await clearDatabase();
      
      console.log('Resetting stores...');
      // Reset the stores
      hashMapStore.set({});
      merkleRoot.set('');
      
      console.log('Clearing local state...');
      // Clear local state
      fullRecords = {};
      
      console.log('Database reset completed successfully');
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
    console.log('Generate Records button clicked');
    if (isGenerating) {
      console.log('Already generating, returning early');
      return; // Prevent multiple simultaneous generations
    }
    
    console.log('Starting record generation...');
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
      console.log('Refreshing records...');
      await refreshRecords();
      console.log('Record generation completed successfully');
    } catch (error) {
      console.error('Error during record generation:', error);
    } finally {
      isGenerating = false;
    }
  }


  // Reactive statement to refresh records when hashMapStore changes
  $: if ($hashMapStore) {
    refreshRecords().catch(error => {
      console.error('Error refreshing records:', error);
    });
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
  <div style="margin: 0; padding: 0; width: 100%; height: 100%;">
    
    <!-- 1. Data Channel View -->
    <DataChannelView {currentMerkleRoot} {p2pMessageData} />

    <!-- 2. Smaller Stats Table -->
    <div class="glass-card" style="display: grid; grid-template-columns: repeat(4, minmax(80px, 1fr)); gap: 8px; margin: 16px 0; padding: 12px;">
      <div class="glass" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px; font-size: 11px; text-align: center;">
        <div style="font-weight: 600; color: var(--text-secondary); margin-bottom: 2px;">Peers</div>
        <div style="font-size: 16px; font-weight: 700; color: var(--accent-primary);">{peersOnline}</div>
      </div>
      <div class="glass" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px; font-size: 11px; text-align: center;">
        <div style="font-weight: 600; color: var(--text-secondary); margin-bottom: 2px;">Records</div>
        <div style="font-size: 16px; font-weight: 700; color: var(--accent-success);">{Object.keys(fullRecords || {}).length}</div>
      </div>
      <div class="glass" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px; font-size: 11px; text-align: center;">
        <div style="font-weight: 600; color: var(--text-secondary); margin-bottom: 2px;">Received</div>
        <div style="font-size: 16px; font-weight: 700; color: var(--accent-warning);">{statReceivedRecords}</div>
      </div>
      <div class="glass" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px; font-size: 11px; text-align: center;">
        <div style="font-weight: 600; color: var(--text-secondary); margin-bottom: 2px;">Sent</div>
        <div style="font-size: 16px; font-weight: 700; color: var(--accent-danger);">{statRecordsSent}</div>
      </div>
    </div>

    <!-- 3. Five Squares in One Row -->
    <div class="glass-card" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 16px 0; padding: 12px;">
      <!-- Number Input Square -->
      <div class="glass" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px; text-align: center;">
        <label for="generateCountInput" style="font-size: 10px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px;">Count</label>
        <input 
          id="generateCountInput" 
          type="number" 
          min="1" 
          max="100000" 
          step="1" 
          bind:value={generateCount} 
          style="width: 100%; text-align: center; font-size: 14px; font-weight: 700; padding: 4px;"
        />
      </div>
      
      <!-- Generate Button Square -->
      <button 
        on:click={generateRecords} 
        disabled={isGenerating}
        class="btn-success glass"
        style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px; text-align: center; font-size: 10px; font-weight: 600;"
      >
        <div style="margin-bottom: 2px;">Generate</div>
        <div style="font-size: 12px; font-weight: 700;">{isGenerating ? '...' : generateCount}</div>
      </button>
      
      <!-- Send Root Hash Button Square -->
      <button 
        on:click={sendRootHash} 
        class="btn-primary glass"
        style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px; text-align: center; font-size: 10px; font-weight: 600;"
      >
        <div style="margin-bottom: 2px;">Send</div>
        <div style="font-size: 12px; font-weight: 700;">Root Hash</div>
      </button>
      
      <!-- Reset Stats Button Square -->
      <button 
        on:click={resetStats} 
        class="btn-warning glass"
        style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px; text-align: center; font-size: 10px; font-weight: 600;"
      >
        <div style="margin-bottom: 2px;">Reset</div>
        <div style="font-size: 12px; font-weight: 700;">Stats</div>
      </button>
      
      <!-- Reset Database Button Square -->
      <button 
        on:click={resetDatabase} 
        class="btn-danger glass"
        style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px; text-align: center; font-size: 10px; font-weight: 600;"
      >
        <div style="margin-bottom: 2px;">Reset</div>
        <div style="font-size: 12px; font-weight: 700;">Database</div>
      </button>
    </div>

    <!-- 4. Record Viewer -->
    <div class="glass-card" style="margin: 20px 0;">
      <h3 style="display: flex; align-items: center; justify-content: center; margin: 0 0 20px 0; color: var(--text-primary);">Record Viewer</h3>
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; margin-bottom: 16px;">
        <label for="pageSizeInput" style="color: var(--text-secondary); font-weight: 600;">Page size:</label>
        <input 
          id="pageSizeInput" 
          type="number" 
          min="10" 
          max="500" 
          step="10" 
          bind:value={pageSize} 
          on:change={() => { currentPage = 1; }} 
          style="width: 100px; text-align: center;" 
        />
      </div>

      {#if Object.keys(fullRecords || {}).length > 0}
        {#key currentPage + ':' + pageSize}
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; margin-bottom: 16px;">
            <span style="color: var(--text-secondary); font-size: 14px;">Total records: <strong style="color: var(--accent-primary);">{Object.keys(fullRecords).length}</strong></span>
          </div>
          <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 16px;">
            <button 
              on:click={() => currentPage = Math.max(1, currentPage - 1)} 
              disabled={currentPage === 1} 
              class="glass"
              style="padding: 8px 16px; font-size: 13px;"
            >
              Prev
            </button>
            <span style="color: var(--text-primary); font-size: 14px;">
              Page <strong style="color: var(--accent-primary);">{currentPage}</strong> of <strong style="color: var(--accent-primary);">{Math.max(1, Math.ceil(Object.keys(fullRecords).length / pageSize))}</strong>
            </span>
            <button 
              on:click={() => currentPage = Math.min(Math.ceil(Object.keys(fullRecords).length / pageSize), currentPage + 1)} 
              disabled={currentPage >= Math.ceil(Object.keys(fullRecords).length / pageSize)} 
              class="glass"
              style="padding: 8px 16px; font-size: 13px;"
            >
              Next
            </button>
          </div>
          <div class="glass" style="max-height: 420px; overflow: auto; border-radius: 8px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
              <thead>
                <tr style="background: var(--glass-bg-hover);">
                  <th style="text-align: left; padding: 12px; color: var(--text-primary); font-weight: 600;">Record ID</th>
                  <th style="text-align: left; padding: 12px; color: var(--text-primary); font-weight: 600;">Created</th>
                  <th style="text-align: left; padding: 12px; color: var(--text-primary); font-weight: 600;">Creator</th>
                  <th style="text-align: left; padding: 12px; color: var(--text-primary); font-weight: 600;">Text</th>
                  <th style="text-align: left; padding: 12px; color: var(--text-primary); font-weight: 600;">Link</th>
                  <th style="text-align: left; padding: 12px; color: var(--text-primary); font-weight: 600;">Details</th>
                </tr>
              </thead>
              <tbody>
                {#each pagedRecords as record}
                  <tr style="transition: all 0.2s ease;">
                    <td style="padding: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--text-primary); font-size: 12px;">{record.uuid}</td>
                    <td style="padding: 12px; color: var(--text-secondary);">{record.createdAt}</td>
                    <td style="padding: 12px; color: var(--text-secondary); font-size: 12px;">{record.creator_npub}</td>
                    <td style="padding: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px; color: var(--text-primary);">{record.text}</td>
                    <td style="padding: 12px; max-width: 180px; overflow: hidden; text-overflow: ellipsis;">
                      {#if record.link}
                        <a href={record.link} target="_blank" rel="noopener noreferrer" style="color: var(--accent-primary); font-size: 12px;">{record.link}</a>
                      {/if}
                    </td>
                    <td style="padding: 12px;">
                      <button 
                        on:click={() => (expanded[record.uuid] = !expanded[record.uuid])} 
                        class="glass"
                        style="padding: 6px 12px; font-size: 12px;"
                      >
                        {expanded[record.uuid] ? 'Hide' : 'Show'}
                      </button>
                    </td>
                  </tr>
                  {#if expanded[record.uuid]}
                    <tr>
                      <td colspan="6" style="padding: 12px; color: var(--text-secondary); font-size: 12px; background: var(--glass-bg);">
                        <div style="margin-bottom: 8px;"><strong style="color: var(--text-primary);">Timestamp</strong>: {record.timestamp}</div>
                        <div style="margin-bottom: 8px;"><strong style="color: var(--text-primary);">Lat</strong>: {record.latitude} · <strong style="color: var(--text-primary);">Lon</strong>: {record.longitude}</div>
                        <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; word-break: break-all;">
                          <div style="margin-bottom: 4px;"><strong style="color: var(--text-primary);">Hash</strong>: {record.integrity?.hash || record.hash || 'N/A'}</div>
                          <div><strong style="color: var(--text-primary);">Signature</strong>: {record.signature}</div>
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
        <div style="color: var(--text-muted); text-align: center; padding: 40px; font-size: 16px;">No records yet.</div>
      {/if}
    </div>
  </div>
</main>
