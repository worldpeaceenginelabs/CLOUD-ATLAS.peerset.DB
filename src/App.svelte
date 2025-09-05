<script lang="ts">
  import { onMount } from 'svelte';
  import { joinRoom } from 'trystero/torrent';
  import { get } from 'svelte/store';
  import { getAllRecords, saveRecord } from './db.js';
  import { sha256 } from './secp256k1.js';
  import { moderateRecord } from './moderation.js';
  import Ui from './UI.svelte';
  
  // --- Stores ---
  import { recordStore, merkleRoot } from './stores';
  import RecordGenerator from './RecordGenerator.svelte';
  
  // --- Stats ---
  let statRecordsSent = 0;
  let statReceivedRecords = 0;
  let statSubtreesExchanged = 0;
  let peerTraffic: Record<string, { sent: number; recv: number }> = {};
  const lastActivity: Record<string, number> = {};
  const IDLE_TIMEOUT = 5000;
  
  // --- P2P ---
  const config = { appId: 'simpleSync' };
  const room = joinRoom(config, 'simpleRoom');
  
  let sendRootHash, getRootHash, sendRecords, getRecords, sendSubtree, getSubtree;
  let processingRecords = false;
  
  // --- Helper Functions ---
  function initPeer(peerId: string) {
    if (!peerTraffic[peerId]) peerTraffic[peerId] = { sent: 0, recv: 0 };
    if (!lastActivity[peerId]) lastActivity[peerId] = Date.now();
  }
  
  async function processRecord(uuid: string, record: any) {
    const approved = await moderateRecord(record);
    if (!approved) return false;
  
    await saveRecord(uuid, record);
    recordStore.update(local => ({ ...local, [uuid]: record.integrity.hash }));
    return true;
  }
  
  // --- Fixed Merkle Tree ---
  interface MerkleNode {
    hash: string;
    left?: MerkleNode;
    right?: MerkleNode;
    uuids: string[];  // ✅ ALL nodes have UUIDs now
    isLeaf?: boolean;
  }
  
  // ✅ Fixed: Build tree with UUIDs propagated to all nodes
  async function buildMerkleTreeNodes(records: Record<string, string>): Promise<MerkleNode> {
    const keys = Object.keys(records).sort();
    
    if (keys.length === 0) {
      return { hash: await sha256(''), uuids: [], isLeaf: true };
    }
  
    // Create leaves with UUIDs
    let nodes: MerkleNode[] = keys.map(uuid => ({
      hash: records[uuid],
      uuids: [uuid],
      isLeaf: true
    }));
  
    // Build tree bottom-up, combining UUIDs
    while (nodes.length > 1) {
      const nextLevel: MerkleNode[] = [];
      
      for (let i = 0; i < nodes.length; i += 2) {
        const left = nodes[i];
        const right = nodes[i + 1];
        
        if (!right) {
          // Odd number - promote single node up
          nextLevel.push(left);
          continue;
        }
  
        // ✅ Combine hashes AND UUIDs
        const combinedHash = await sha256(left.hash + right.hash);
        const combinedUUIDs = [...left.uuids, ...right.uuids].sort();
        
        nextLevel.push({
          hash: combinedHash,
          left,
          right,
          uuids: combinedUUIDs,
          isLeaf: false
        });
      }
      
      nodes = nextLevel;
    }
  
    return nodes[0];
  }
  
  // ✅ Fixed: Proper diffing that works with internal nodes
  function findMissingUUIDs(localNode: MerkleNode, remoteNode?: MerkleNode): string[] {
    // If remote doesn't have this subtree, we have all UUIDs they're missing
    if (!remoteNode) {
      return localNode.uuids;
    }
    
    // If hashes match, no differences in this subtree
    if (localNode.hash === remoteNode.hash) {
      return [];
    }
    
    // If we're at a leaf, return the UUID
    if (localNode.isLeaf) {
      return localNode.uuids;
    }
    
    // Recurse into children
    const leftMissing = findMissingUUIDs(
      localNode.left!,
      remoteNode.left
    );
    
    const rightMissing = findMissingUUIDs(
      localNode.right!,
      remoteNode.right
    );
    
    return [...leftMissing, ...rightMissing];
  }
  
  // ✅ New: Find which subtrees to request from peer
  function findNeededSubtrees(localNode: MerkleNode, remoteNode?: MerkleNode): MerkleNode[] {
    if (!remoteNode || localNode.hash === remoteNode.hash) {
      return [];
    }
    
    if (remoteNode.isLeaf) {
      return [remoteNode];
    }
    
    const neededSubtrees: MerkleNode[] = [];
    
    if (remoteNode.left && 
        (!localNode.left || localNode.left.hash !== remoteNode.left.hash)) {
      neededSubtrees.push(...findNeededSubtrees(localNode.left, remoteNode.left));
    }
    
    if (remoteNode.right && 
        (!localNode.right || localNode.right.hash !== remoteNode.right.hash)) {
      neededSubtrees.push(...findNeededSubtrees(localNode.right, remoteNode.right));
    }
    
    return neededSubtrees;
  }
  
  // --- Main P2P Sync Workflow ---
  onMount(async () => {
    [sendRootHash, getRootHash] = room.makeAction('rootHash');
    [sendRecords, getRecords] = room.makeAction('fullRecords');
    [sendSubtree, getSubtree] = room.makeAction('subtree'); // ✅ New subtree exchange
  
    // Load persisted records
    const persisted = await getAllRecords();
    const hashMap: Record<string, string> = {};
    for (const [uuid, record] of Object.entries(persisted)) {
      hashMap[uuid] = record.integrity.hash;
    }
    recordStore.set(hashMap);
  
    const localRoot = await buildMerkleTreeNodes(hashMap);
    merkleRoot.set(localRoot.hash);
    console.log(`[SimpleSync] Loaded ${Object.keys(hashMap).length} persisted records`);
  
    // Peer joins
    room.onPeerJoin(peerId => {
      console.log(`[SimpleSync] Peer ${peerId} joined`);
      initPeer(peerId);
      // ✅ Send only root hash first, not full tree
      sendRootHash({ rootHash: localRoot.hash }, peerId);
    });
  
    // Peer leaves
    room.onPeerLeave(peerId => {
      console.log(`[SimpleSync] Peer ${peerId} left`);
      delete peerTraffic[peerId];
      delete lastActivity[peerId];
    });
  
    // ✅ Fixed: Receive root hash and start incremental sync
    getRootHash(async (peerData, peerId) => {
      if (!peerTraffic[peerId]) return;
      initPeer(peerId);
      peerTraffic[peerId].recv++;
  
      const localHashes = get(recordStore);
      const localRoot = await buildMerkleTreeNodes(localHashes);
  
      if (peerData.rootHash !== localRoot.hash) {
        console.log(`[SimpleSync] Root differs with peer ${peerId}. Requesting subtrees...`);
        
        // Request their root subtree to start comparison
        sendSubtree({ requestRoot: true }, peerId);
      }
  
      lastActivity[peerId] = Date.now();
    });
  
    // ✅ Fixed: Handle subtree requests and exchanges
    getSubtree(async (request, peerId) => {
      initPeer(peerId);
      
      if (request.requestRoot) {
        // Send our full tree for comparison
        const localHashes = get(recordStore);
        const localRoot = await buildMerkleTreeNodes(localHashes);
        sendSubtree({ tree: localRoot }, peerId);
        return;
      }
      
      if (request.tree) {
        // This is a tree comparison - find what each peer needs
        const localHashes = get(recordStore);
        const localRoot = await buildMerkleTreeNodes(localHashes);
        
        // Find what we have that they're missing
        const theyNeed = findMissingUUIDs(localRoot, request.tree);
        
        // Find what they have that we're missing  
        const weNeed = findMissingUUIDs(request.tree, localRoot);
        
        // Send them what they need
        if (theyNeed.length > 0) {
          const allRecords = await getAllRecords();
          const toSend: Record<string, any> = {};
          for (const uuid of theyNeed) {
            if (allRecords[uuid]) {
              toSend[uuid] = allRecords[uuid];
            }
          }
          
          if (Object.keys(toSend).length > 0) {
            sendRecords(toSend, peerId);
            statRecordsSent += Object.keys(toSend).length;
            peerTraffic[peerId].sent += Object.keys(toSend).length;
            console.log(`[SimpleSync] Sent ${Object.keys(toSend).length} records to ${peerId}`);
          }
        }
        
        // Request what we need from them
        if (weNeed.length > 0) {
          sendSubtree({ requestUUIDs: weNeed }, peerId);
          statSubtreesExchanged++;
        }
      }
      
      if (request.requestUUIDs) {
        // Send specific records they requested
        const allRecords = await getAllRecords();
        const toSend: Record<string, any> = {};
        for (const uuid of request.requestUUIDs) {
          if (allRecords[uuid]) {
            toSend[uuid] = allRecords[uuid];
          }
        }
        
        if (Object.keys(toSend).length > 0) {
          sendRecords(toSend, peerId);
          statRecordsSent += Object.keys(toSend).length;
          peerTraffic[peerId].sent += Object.keys(toSend).length;
        }
      }
      
      lastActivity[peerId] = Date.now();
    });
  
    // Receive records from peer (unchanged)
    getRecords(async (records: Record<string, any>, peerId) => {
      if (processingRecords) return;
      processingRecords = true;
      initPeer(peerId);
  
      const incomingCount = Object.keys(records).length;
      statReceivedRecords += incomingCount;
      peerTraffic[peerId].recv += incomingCount;
  
      let processedCount = 0;
      for (const [uuid, record] of Object.entries(records)) {
        if (await processRecord(uuid, record)) processedCount++;
      }
  
      console.log(`[SimpleSync] Processed ${processedCount}/${incomingCount} records from ${peerId}`);
  
      // Update Merkle root
      const hashes = get(recordStore);
      const root = await buildMerkleTreeNodes(hashes);
      merkleRoot.set(root.hash);
  
      lastActivity[peerId] = Date.now();
      processingRecords = false;
    });
  
    // ✅ Fixed: Periodic sync with just root hash
    setInterval(async () => {
      const now = Date.now();
      for (const peerId in lastActivity) {
        if (now - lastActivity[peerId] > IDLE_TIMEOUT) {
          console.log(`[SimpleSync] Peer ${peerId} idle, sending root hash`);
          const hashes = get(recordStore);
          const root = await buildMerkleTreeNodes(hashes);
          sendRootHash({ rootHash: root.hash }, peerId);
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