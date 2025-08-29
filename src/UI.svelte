<script lang="ts">
  import { v4 as uuidv4 } from 'uuid';
  import { recordStore, uuidStore } from './tempstores.js';
  import { saveRecords } from './db.js';

  export let statReceivedRecords = 0;
  export let statBucketsExchanged = 0;
  export let statUUIDsExchanged = 0;
  export let statRecordsExchanged = 0;
  export let peerTraffic: Record<string, { sent: { buckets:number; uuids:number; requests:number; records:number }, recv: { buckets:number; uuids:number; requests:number; records:number } }> = {};

  const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

  let lastGenMs = 0;
  let lastGenKB = 0;

  // Record viewer state and derived values
  let selectedBucket: string | null = null;
  let pageSize = 50;
  let currentPage = 1;
  let expanded: Record<string, boolean> = {};

  $: if (!selectedBucket) {
    const keys = Object.keys($uuidStore || {}).sort();
    if (keys.length > 0) selectedBucket = keys[keys.length - 1];
  }

  $: pagedUUIDs = (() => {
    if (!selectedBucket) return [] as string[];
    const all = ($uuidStore && $uuidStore[selectedBucket]) ? $uuidStore[selectedBucket] : [];
    const start = (currentPage - 1) * pageSize;
    return all.slice(start, start + pageSize);
  })();

  async function generateRecords(count = 10000) {
    const t0 = performance.now();

    const records: Record<string, any> = {};
    let totalBytes = 0;

    for (let i = 0; i < count; i++) {
      const uuid = uuidv4();
      const bucket_number = randomInt(100, 300);
      const bucketId = `day${bucket_number}`;
      const rec = {
        uuid,
        bucketId,
        createdAt: new Date().toISOString(),
        // user-requested shape
        timestamp: new Date(Date.now() - randomInt(0, 7) * 24 * 60 * 60 * 1000).toISOString(),
        bucket_number,
        creator_npub: `npub1${Math.random().toString(36).slice(2, 12)}`,
        text: `Some mission text ${i}`,
        link: `https://example.com/${i}`,
        latitude: +(Math.random() * 180 - 90).toFixed(5),
        longitude: +(Math.random() * 360 - 180).toFixed(5),
        hash: Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b=>b.toString(16).padStart(2,'0')).join(''),
        signature: Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,'0')).join('')
      };
      records[uuid] = rec;
      totalBytes += JSON.stringify(rec).length;
    }

    // Persist to IndexedDB in bulk
    await saveRecords(records);

    // Update in-memory stores immutably
    recordStore.update(local => ({ ...local, ...records }));
    uuidStore.update(local => {
      const updated: Record<string, string[]> = { ...local } as any;
      for (const uuid in records) {
        const b = records[uuid].bucketId;
        const list = updated[b] ? [...updated[b]] : [];
        list.push(uuid);
        updated[b] = list;
      }
      return updated as any;
    });

    const t1 = performance.now();
    lastGenMs = Math.round(t1 - t0);
    lastGenKB = Math.round(totalBytes / 1024);
    console.log(`Generated ${count} records in ${lastGenMs} ms, ~${lastGenKB} KB`);
  }
</script>

<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 12px; line-height: 1.4;">
  <h3 style="margin: 0 0 8px;">Sync stats</h3>
  <div style="display: grid; grid-template-columns: repeat(2, minmax(180px, 1fr)); gap: 8px; max-width: 600px;">
    <div style="padding:8px;border:1px solid #ddd;border-radius:6px;">Local records: <strong>{Object.keys($recordStore || {}).length}</strong></div>
    <div style="padding:8px;border:1px solid #ddd;border-radius:6px;">Received records: <strong>{statReceivedRecords}</strong></div>
    <div style="padding:8px;border:1px solid #ddd;border-radius:6px;">Buckets exchanged: <strong>{statBucketsExchanged}</strong></div>
    <div style="padding:8px;border:1px solid #ddd;border-radius:6px;">UUIDs exchanged: <strong>{statUUIDsExchanged}</strong></div>
    <div style="padding:8px;border:1px solid #ddd;border-radius:6px;">Records exchanged: <strong>{statRecordsExchanged}</strong></div>
    <div style="padding:8px;border:1px solid #ddd;border-radius:6px; grid-column: 1 / -1; display:flex; gap:8px; align-items:center;">
      <button on:click={() => generateRecords(10000)} style="padding:8px 12px; border:1px solid #999; border-radius:6px; background:#f7f7f7; cursor:pointer;">Generate 10,000 local records</button>
      <span>Last gen: <strong>{lastGenMs}</strong> ms, <strong>{lastGenKB}</strong> KB</span>
    </div>
  </div>

  <h3 style="margin: 16px 0 8px;">Record viewer</h3>
  <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
    {#if Object.keys($uuidStore || {}).length > 0}
      <label>Bucket:</label>
      <select bind:value={selectedBucket} on:change={() => { currentPage = 1; }} style="padding:6px;border:1px solid #ccc;border-radius:4px;">
        {#each Object.keys($uuidStore).sort() as b}
          <option value={b}>{b}</option>
        {/each}
      </select>
    {:else}
      <span style="color:#666;">No buckets yet.</span>
    {/if}
    <label>Page size:</label>
    <input type="number" min="10" max="500" step="10" bind:value={pageSize} on:change={() => { currentPage = 1; }} style="width:80px;padding:6px;border:1px solid #ccc;border-radius:4px;" />
  </div>

  {#if selectedBucket}
    {#key selectedBucket + ':' + currentPage + ':' + pageSize}
      <div style="margin-bottom:8px;">
        {#if $uuidStore[selectedBucket]}
          <span>Total in {selectedBucket}: <strong>{$uuidStore[selectedBucket].length}</strong></span>
        {:else}
          <span>No records in {selectedBucket}.</span>
        {/if}
      </div>

      {#if $uuidStore[selectedBucket] && $uuidStore[selectedBucket].length > 0}
        <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
          <button on:click={() => currentPage = Math.max(1, currentPage - 1)} disabled={currentPage === 1} style="padding:6px 10px;border:1px solid #999;border-radius:4px;background:#f7f7f7;cursor:pointer;">Prev</button>
          <span>Page <strong>{currentPage}</strong> of <strong>{Math.max(1, Math.ceil($uuidStore[selectedBucket].length / pageSize))}</strong></span>
          <button on:click={() => currentPage = Math.min(Math.ceil($uuidStore[selectedBucket].length / pageSize), currentPage + 1)} disabled={currentPage >= Math.ceil($uuidStore[selectedBucket].length / pageSize)} style="padding:6px 10px;border:1px solid #999;border-radius:4px;background:#f7f7f7;cursor:pointer;">Next</button>
        </div>

        <div style="max-height:420px; overflow:auto; border:1px solid #eee; border-radius:6px;">
          <table style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead>
              <tr style="background:#f0f0f0; color:#000;">
                <th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">UUID</th>
                <th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Bucket</th>
                <th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Bucket #</th>
                <th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Created</th>
                <th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Creator</th>
                <th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Text</th>
                <th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Link</th>
                <th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Details</th>
              </tr>
            </thead>
            <tbody>
              {#each pagedUUIDs as id}
                {#if $recordStore[id]}
                  <tr>
                    <td style="padding:8px;border-bottom:1px solid #f2f2f2; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;">{id}</td>
                    <td style="padding:8px;border-bottom:1px solid #f2f2f2;">{$recordStore[id].bucketId}</td>
                    <td style="padding:8px;border-bottom:1px solid #f2f2f2;">{$recordStore[id].bucket_number}</td>
                    <td style="padding:8px;border-bottom:1px solid #f2f2f2;">{$recordStore[id].createdAt}</td>
                    <td style="padding:8px;border-bottom:1px solid #f2f2f2;">{$recordStore[id].creator_npub}</td>
                    <td style="padding:8px;border-bottom:1px solid #f2f2f2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:280px;">{$recordStore[id].text}</td>
                    <td style="padding:8px;border-bottom:1px solid #f2f2f2; max-width:180px; overflow:hidden; text-overflow:ellipsis;">
                      {#if $recordStore[id].link}
                        <a href={$recordStore[id].link} target="_blank" rel="noopener noreferrer">{$recordStore[id].link}</a>
                      {/if}
                    </td>
                    <td style="padding:8px;border-bottom:1px solid #f2f2f2;">
                      <button on:click={() => (expanded[id] = !expanded[id])} style="padding:4px 8px;border:1px solid #ccc;border-radius:4px;background:#fafafa;cursor:pointer;">
                        {expanded[id] ? 'Hide' : 'Show'}
                      </button>
                    </td>
                  </tr>
                  {#if expanded[id]}
                    <tr>
                      <td colspan="8" style="padding:8px 8px 12px; border-bottom:1px solid #f2f2f2; color:inherit; font-size:12px;">
                        <div><strong>timestamp</strong>: {$recordStore[id].timestamp}</div>
                        <div><strong>lat</strong>: {$recordStore[id].latitude} · <strong>lon</strong>: {$recordStore[id].longitude}</div>
                        <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; word-break: break-all;">
                          <div><strong>hash</strong>: {$recordStore[id].hash}</div>
                          <div><strong>signature</strong>: {$recordStore[id].signature}</div>
                        </div>
                      </td>
                    </tr>
                  {/if}
                {/if}
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/key}
  {/if}

  <h3 style="margin: 16px 0 8px;">Per-peer traffic</h3>
  {#if Object.keys(peerTraffic || {}).length === 0}
    <div style="color:#666;">No peer traffic yet.</div>
  {:else}
    <div style="max-width: 800px; overflow:auto; border:1px solid #eee; border-radius:6px;">
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead>
          <tr style="background:#fafafa;">
            <th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Peer ID</th>
            <th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Sent: buckets</th>
            <th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Sent: uuids</th>
            <th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Sent: requests</th>
            <th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Sent: records</th>
            <th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Recv: buckets</th>
            <th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Recv: uuids</th>
            <th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Recv: requests</th>
            <th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Recv: records</th>
          </tr>
        </thead>
        <tbody>
          {#each Object.keys(peerTraffic).sort() as pid}
            <tr>
              <td style="padding:8px;border-bottom:1px solid #f2f2f2;">{pid}</td>
              <td style="padding:8px;border-bottom:1px solid #f2f2f2;">{peerTraffic[pid].sent.buckets}</td>
              <td style="padding:8px;border-bottom:1px solid #f2f2f2;">{peerTraffic[pid].sent.uuids}</td>
              <td style="padding:8px;border-bottom:1px solid #f2f2f2;">{peerTraffic[pid].sent.requests}</td>
              <td style="padding:8px;border-bottom:1px solid #f2f2f2;">{peerTraffic[pid].sent.records}</td>
              <td style="padding:8px;border-bottom:1px solid #f2f2f2;">{peerTraffic[pid].recv.buckets}</td>
              <td style="padding:8px;border-bottom:1px solid #f2f2f2;">{peerTraffic[pid].recv.uuids}</td>
              <td style="padding:8px;border-bottom:1px solid #f2f2f2;">{peerTraffic[pid].recv.requests}</td>
              <td style="padding:8px;border-bottom:1px solid #f2f2f2;">{peerTraffic[pid].recv.records}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>


