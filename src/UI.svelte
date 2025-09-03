<script lang="ts">
  import { recordStore, merkleRoot } from './stores';

  // --- UI sync stats ---
  export let statReceivedRecords = 0;
  export let statSubtreesExchanged = 0;
  export let statRecordsRequested = 0;
  export let statRecordsExchanged = 0;
  export let peerTraffic: Record<string, { sent: { buckets: number; uuids: number; requests: number; records: number }, recv: { buckets: number; uuids: number; requests: number; records: number } }> = {};

  // Derive peers online
  $: peersOnline = Object.keys(peerTraffic || {}).length;

  const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

  let lastGenMs = 0;
  let lastGenKB = 0;

  // Record viewer state
  let pageSize = 50;
  let currentPage = 1;
  let expanded: Record<string, boolean> = {};

  // Derive paged records from recordStore
  $: pagedRecords = (() => {
    const allRecords = Object.values($recordStore || {}).sort((a, b) => {
      const aCreated = a.createdAt || (a.created_at ? new Date(a.created_at).toISOString() : '') || '';
      const bCreated = b.createdAt || (b.created_at ? new Date(b.created_at).toISOString() : '') || '';
      return aCreated.localeCompare(bCreated);
    });
    const start = (currentPage - 1) * pageSize;
    return allRecords.slice(start, start + pageSize);
  })();

</script>

<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 12px; line-height: 1.4; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;">
  <h3 style="margin: 0 0 8px;">Sync Stats</h3>
  <div style="display: grid; grid-template-columns: repeat(2, minmax(180px, 1fr)); gap: 8px; max-width: 600px;">
    <div style="padding: 8px; border: 1px solid #ddd; border-radius: 6px;">Peers online: <strong>{peersOnline}</strong></div>
    <div style="padding: 8px; border: 1px solid #ddd; border-radius: 6px;">Local records: <strong>{Object.keys($recordStore || {}).length}</strong></div>
    <div style="padding: 8px; border: 1px solid #ddd; border-radius: 6px;">Records received: <strong>{statReceivedRecords}</strong></div>
    <div style="padding: 8px; border: 1px solid #ddd; border-radius: 6px;">Subtrees exchanged: <strong>{statSubtreesExchanged}</strong></div>
    <div style="padding: 8px; border: 1px solid #ddd; border-radius: 6px;">Records requested: <strong>{statRecordsRequested}</strong></div>
    <div style="padding: 8px; border: 1px solid #ddd; border-radius: 6px;">Records sent: <strong>{statRecordsExchanged}</strong></div>
    <div style="padding: 8px; border: 1px solid #ddd; border-radius: 6px; grid-column: 1 / -1;">
      Root hash: <strong>{$merkleRoot ? $merkleRoot.substring(0, 8) + '...' : 'Empty'}</strong>
    </div>
    
  </div>

  <h3 style="margin: 16px 0 8px;">Per-peer Traffic</h3>
  {#if Object.keys(peerTraffic || {}).length === 0}
    <div style="color: #666;">No peer traffic yet.</div>
  {:else}
    <div style="max-width: 800px; overflow: auto; border: 1px solid #eee; border-radius: 6px;">
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="background: #fafafa; color: #000;">
            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">Peer ID</th>
            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">Recv: Buckets</th>
            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">Sent: Buckets</th>
            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">Recv: UUIDs</th>
            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">Sent: UUIDs</th>
            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">Recv: Requests</th>
            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">Sent: Requests</th>
          </tr>
        </thead>
        <tbody>
          {#each Object.keys(peerTraffic).sort() as pid}
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #f2f2f2;">{pid}</td>
              <td style="padding: 8px; border-bottom: 1px solid #f2f2f2;">{peerTraffic[pid].recv.subtrees}</td>
              <td style="padding: 8px; border-bottom: 1px solid #f2f2f2;">{peerTraffic[pid].sent.subtrees}</td>
              <td style="padding: 8px; border-bottom: 1px solid #f2f2f2;">{peerTraffic[pid].recv.records}</td>
              <td style="padding: 8px; border-bottom: 1px solid #f2f2f2;">{peerTraffic[pid].sent.records}</td>
              <td style="padding: 8px; border-bottom: 1px solid #f2f2f2;">{peerTraffic[pid].recv.requests}</td>
              <td style="padding: 8px; border-bottom: 1px solid #f2f2f2;">{peerTraffic[pid].sent.requests}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <h3 style="margin: 16px 0 8px;">Record Viewer</h3>
  <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
    <label for="pageSizeInput">Page size:</label>
    <input id="pageSizeInput" type="number" min="10" max="500" step="10" bind:value={pageSize} on:change={() => { currentPage = 1; }} style="width: 80px; padding: 6px; border: 1px solid #ccc; border-radius: 4px;" />
  </div>

  {#if Object.keys($recordStore || {}).length > 0}
    {#key currentPage + ':' + pageSize}
      <div style="margin-bottom: 8px;">
        <span>Total records: <strong>{Object.keys($recordStore).length}</strong></span>
      </div>
      <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
        <button on:click={() => currentPage = Math.max(1, currentPage - 1)} disabled={currentPage === 1} style="padding: 6px 10px; border: 1px solid #999; border-radius: 4px; background: #f7f7f7; cursor: pointer;">Prev</button>
        <span>Page <strong>{currentPage}</strong> of <strong>{Math.max(1, Math.ceil(Object.keys($recordStore).length / pageSize))}</strong></span>
        <button on:click={() => currentPage = Math.min(Math.ceil(Object.keys($recordStore).length / pageSize), currentPage + 1)} disabled={currentPage >= Math.ceil(Object.keys($recordStore).length / pageSize)} style="padding: 6px 10px; border: 1px solid #999; border-radius: 4px; background: #f7f7f7; cursor: pointer;">Next</button>
      </div>
      <div style="max-height: 420px; overflow: auto; border: 1px solid #eee; border-radius: 6px;">
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