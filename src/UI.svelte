<script lang="ts">
  import { merkleRoot } from './stores';
  import { getAllRecords } from './db';
  import { onMount } from 'svelte';

  // --- UI sync stats ---
  export let statReceivedRecords = 0;
  export let statSubtreesExchanged = 0;
  export let statRecordsSent = 0;
  export let peerTraffic: Record<
    string,
    {
      sent: { rootHashes: number; subtrees: number; records: number },
      recv: { rootHashes: number; subtrees: number; records: number }
    }
  > = {};

  // Derive peers online
  $: peersOnline = Object.keys(peerTraffic || {}).length;

  // Local state for full records (loaded from IndexedDB)
  let fullRecords: Record<string, any> = {};

  // Record viewer state
  let pageSize = 50;
  let currentPage = 1;
  let expanded: Record<string, boolean> = {};

  // Load full records from IndexedDB when component mounts
  onMount(async () => {
    fullRecords = await getAllRecords();
  });

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
    </div>

    <div style="display: grid; grid-template-columns: repeat(2, minmax(150px, 1fr)); gap: 8px;">
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; background-color:green; padding: 8px; border: 1px solid #ddd; border-radius: 6px;">
        Peers online: <strong>{peersOnline}</strong>
      </div>
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;background-color:green; padding: 8px; border: 1px solid #ddd; border-radius: 6px;">
        Records received: <strong>{statReceivedRecords}</strong>
      </div>
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;background-color:green; padding: 8px; border: 1px solid #ddd; border-radius: 6px;">
        Subtrees exchanged: <strong>{statSubtreesExchanged}</strong>
      </div>
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;background-color:green; padding: 8px; border: 1px solid #ddd; border-radius: 6px;">
        Records sent: <strong>{statRecordsSent}</strong>
      </div>
      
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;background-color:green; padding: 8px; border: 1px solid #ddd; border-radius: 6px; grid-column: 1 / -1;">
        Root hash: <strong>{$merkleRoot.substring(0, 9)}</strong> 
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
