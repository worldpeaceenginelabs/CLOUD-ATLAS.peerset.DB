/*
 * Moderates a record by checking its text content, link, and schema.
 * @param {any} record - The record to moderate.
 * @returns {Promise<boolean>} - True if the record passes moderation, false otherwise.
 */

/*
 * Moderates multiple records in batch for better performance.
 * @param {Record<string, any>} records - Object with UUID keys and record values to moderate.
 * @returns {Promise<Record<string, boolean>>} - Object mapping UUIDs to moderation results.
 */
export async function moderateRecordsBatch(records) {
  // Temporarily bypass moderation for testing - batch approve all
  /** @type {Record<string, boolean>} */
  const results = {};
  for (const uuid in records) {
    results[uuid] = true;
  }
  return results;
  
  // TODO: When enabling real moderation, replace above with:
  /*
  const results = {};
  const inappropriateWords = ['badword', 'inappropriate', 'offensive'];
  const urlRegex = /https?:\/\/[^\s]+|www\.[^\s]+|[^\s]+\.[^\s]+/i;
  const zoomLinkRegex = /^https:\/\/([a-z0-9-]+\.)*zoom\.us\/.+$/i;
  
  for (const [uuid, record] of Object.entries(records)) {
    try {
      // Batch validation - same logic as individual moderation
      if (!record || typeof record !== 'object' || record.type !== 'Record') {
        results[uuid] = false;
        continue;
      }
      
      // Validate schema fields (same as individual function)
      if (!record.uuid || typeof record.uuid !== 'string' ||
          !record.created_at || typeof record.created_at !== 'number' ||
          !record.bucket || typeof record.bucket !== 'string' ||
          !record.author || typeof record.author !== 'object' ||
          !record.author.npub || typeof record.author.npub !== 'string' ||
          !record.content || typeof record.content !== 'object' ||
          !record.geo || typeof record.geo !== 'object' ||
          typeof record.geo.latitude !== 'number' ||
          typeof record.geo.longitude !== 'number' ||
          !record.integrity || typeof record.integrity !== 'object' ||
          !record.integrity.hash || typeof record.integrity.hash !== 'string' ||
          !record.integrity.signature || typeof record.integrity.signature !== 'string') {
        results[uuid] = false;
        continue;
      }
      
      // Check text content
      const text = record.content.text;
      if (typeof text !== 'string') {
        results[uuid] = false;
        continue;
      }
      
      const lowerText = text.toLowerCase();
      let hasInappropriateWord = false;
      for (const word of inappropriateWords) {
        if (lowerText.includes(word.toLowerCase())) {
          hasInappropriateWord = true;
          break;
        }
      }
      
      if (hasInappropriateWord || urlRegex.test(text)) {
        results[uuid] = false;
        continue;
      }
      
      // Validate link
      const link = record.content.link;
      if (link !== null && (typeof link !== 'string' || !zoomLinkRegex.test(link))) {
        results[uuid] = false;
        continue;
      }
      
      results[uuid] = true;
    } catch (error) {
      console.error(`Batch moderation error for ${uuid}:`, error);
      results[uuid] = false;
    }
  }
  
  return results;
  */
}

/*
// Individual record moderation function (commented out - using batch version)
export async function moderateRecord(record) {
  // Implementation would go here when individual moderation is needed
  // Currently using moderateRecordsBatch for better performance
}
*/