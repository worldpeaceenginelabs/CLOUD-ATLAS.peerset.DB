<script lang="ts">
  import { v4 as uuidv4 } from 'uuid';
  import { recordStore, merkleRoot } from './stores.ts';
  import { saveRecord } from './db.js';
  import { sha256 } from './secp256k1.js';

  export let statReceivedRecords = 0;
  export let statBucketsExchanged = 0;
  export let statUUIDsExchanged = 0;
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
    const allRecords = Object.values($recordStore || {}).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const start = (currentPage - 1) * pageSize;
    return allRecords.slice(start, start + pageSize);
  })();

  async function generateRecords(count = 10000) {
    const t0 = performance.now();
    const records: Record<string, any> = {};
    let totalBytes = 0;

    for (let i = 0; i < count; i++) {
      const uuid = uuidv4();
      const record = {
        uuid,
        createdAt: new Date().toISOString(),
        timestamp: new Date(Date.now() - randomInt(0, 7) * 24 * 60 * 60 * 1000).toISOString(),
        creator_npub: `npub1${Math.random().toString(36).slice(2, 12)}`,
        text: `Mission text ${i}`,
        link: `https://example.com/${i}`,
        latitude: +(Math.random() * 180 - 90).toFixed(5),
        longitude: +(Math.random() * 360 - 180).toFixed(5),
        signature: Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('')
      };
      // Compute hash for Merkle tree compatibility
      record.hash = await sha256(JSON.stringify(record));
      records[uuid] = record;
      totalBytes += JSON.stringify(record).length;

      // Save to IndexedDB individually to match your app's saveRecord usage
      await saveRecord(uuid, record);
    }

    // Update recordStore
    recordStore.update(local => ({ ...local, ...records }));

    const t1 = performance.now();
    lastGenMs = Math.round(t1 - t0);
    lastGenKB = Math.round(totalBytes / 1024);
    console.log(`Generated ${count} records in ${lastGenMs} ms, ~${lastGenKB} KB`);
  }
</script>

<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 12px; line-height: 1.4; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;">
  <h3 style="margin: 0 0 8px;">Sync Stats</h3>
  <div style="display: grid; grid-template-columns: repeat(2, minmax(180px, 1fr)); gap: 8px; max-width: 600px;">
    <div style="padding: 8px; border: 1px solid #ddd; border-radius: 6px;">Peers online: <strong>{peersOnline}</strong></div>
    <div style="padding: 8px; border: 1px solid #ddd; border-radius: 6px;">Local records: <strong>{Object.keys($recordStore || {}).length}</strong></div>
    <div style="padding: 8px; border: 1px solid #ddd; border-radius: 6px; grid-column: 1 / -1;">
      Merkle root: <strong>{$merkleRoot ? $merkleRoot.substring(0, 8) + '...' : 'None'}</strong>
    </div>
    <div style="padding: 8px; border: 1px solid #ddd; border-radius: 6px; grid-column: 1 / -1; display: flex; gap: 8px; align-items: center;">
      <button on:click={() => generateRecords(10000)} style="padding: 8px 12px; border: 1px solid #999; border-radius: 6px; background: #f7f7f7; cursor: pointer;">Generate 10,000 records</button>
      <span>Last gen: <strong>{lastGenMs}</strong> ms, <strong>{lastGenKB}</strong> KB</span>
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
            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">Recv: buckets</th>
            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">Sent: buckets</th>
            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">Recv: uuids</th>
            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">Sent: uuids</th>
            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">Recv: requests</th>
            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">Sent: requests</th>
            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">Recv: records</th>
            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">Sent: records</th>
          </tr>
        </thead>
        <tbody>
          {#each Object.keys(peerTraffic).sort() as pid}
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #f2f2f2;">{pid}</td>
              <td style="padding: 8px; border-bottom: 1px solid #f2f2f2;">{peerTraffic[pid].recv.buckets}</td>
              <td style="padding: 8px; border-bottom: 1px solid #f2f2f2;">{peerTraffic[pid].sent.buckets}</td>
              <td style="padding: 8px; border-bottom: 1px solid #f2f2f2;">{peerTraffic[pid].recv.uuids}</td>
              <td style="padding: 8px; border-bottom: 1px solid #f2f2f2;">{peerTraffic[pid].sent.uuids}</td>
              <td style="padding: 8px; border-bottom: 1px solid #f2f2f2;">{peerTraffic[pid].recv.requests}</td>
              <td style="padding: 8px; border-bottom: 1px solid #f2f2f2;">{peerTraffic[pid].sent.requests}</td>
              <td style="padding: 8px; border-bottom: 1px solid #f2f2f2;">{peerTraffic[pid].recv.records}</td>
              <td style="padding: 8px; border-bottom: 1px solid #f2f2f2;">{peerTraffic[pid].sent.records}</td>
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
              <th style="text-align: left; padding: 8px; border-bottom: 1px solid #eee;">UUID</th>
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
                      <div><strong>Hash</strong>: {record.hash}</div>
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