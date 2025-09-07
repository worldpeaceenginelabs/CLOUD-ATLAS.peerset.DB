import { sha256 } from './secp256k1.js';

// --- Merkle Tree Types and Interfaces ---

export interface MerkleNode {
  hash: string;
  left?: MerkleNode;
  right?: MerkleNode;
  uuids: string[];  // ALL nodes have UUIDs now
  isLeaf?: boolean;
}

interface MerkleTreeCache {
  hashes: Record<string, string>;
  root: MerkleNode;
  timestamp: number;
}

// --- Cache Management ---

let merkleTreeCache: MerkleTreeCache | null = null;
const MERKLE_CACHE_TTL = 1000; // Cache Merkle tree for 1 second

/**
 * Get cached Merkle tree or build new one
 */
export async function getMerkleTree(hashes: Record<string, string>): Promise<MerkleNode> {
  const now = Date.now();
  
  // Check if cache is valid
  if (merkleTreeCache && 
      now - merkleTreeCache.timestamp < MERKLE_CACHE_TTL &&
      JSON.stringify(merkleTreeCache.hashes) === JSON.stringify(hashes)) {
    return merkleTreeCache.root;
  }
  
  // Build new tree and cache it
  const root = await buildMerkleTreeNodes(hashes);
  merkleTreeCache = { hashes: { ...hashes }, root, timestamp: now };
  return root;
}

// --- Merkle Tree Building ---

/**
 * Builds a Merkle tree from record hashes with UUIDs propagated to all nodes.
 * This enables efficient diffing by knowing which records are in each subtree.
 * 
 * @param records - Object mapping UUIDs to their hash values
 * @returns Root MerkleNode with all UUIDs in the tree
 */
export async function buildMerkleTreeNodes(records: Record<string, string>): Promise<MerkleNode> {
  const keys = Object.keys(records).sort();
  
  // Handle empty tree case
  if (keys.length === 0) {
    return { hash: await sha256(''), uuids: [], isLeaf: true };
  }

  // Create leaf nodes - each contains one record's hash and UUID
  let nodes: MerkleNode[] = keys.map(uuid => ({
    hash: records[uuid], // Hash of the record content
    uuids: [uuid], // Single UUID for leaf nodes
    isLeaf: true
  }));

  // Build tree bottom-up, combining nodes pairwise
  while (nodes.length > 1) {
    const nextLevel: MerkleNode[] = [];
    
    for (let i = 0; i < nodes.length; i += 2) {
      const left = nodes[i];
      const right = nodes[i + 1];
      
      if (!right) {
        // Odd number of nodes - promote the last node up unchanged
        nextLevel.push(left);
        continue;
      }

      // Combine two nodes: hash their concatenated hashes
      const combinedHash = await sha256(left.hash + right.hash);
      // Combine and sort UUIDs from both subtrees
      const combinedUUIDs = [...left.uuids, ...right.uuids].sort();
      
      nextLevel.push({
        hash: combinedHash,
        left,
        right,
        uuids: combinedUUIDs, // All UUIDs in this subtree
        isLeaf: false
      });
    }
    
    nodes = nextLevel;
  }

  return nodes[0]; // Return the root node
}

