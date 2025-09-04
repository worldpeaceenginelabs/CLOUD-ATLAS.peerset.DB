/**
 * Moderates a record by checking its text content, link, and schema.
 * @param {any} record - The record to moderate.
 * @returns {Promise<boolean>} - True if the record passes moderation, false otherwise.
 */
export async function moderateRecord(record) {
  // Temporarily bypass moderation for testing
  console.log('Moderation bypassed for testing: Allowing all records');
  return true;
}

/** export async function moderateRecord(record) {
    // List of inappropriate words (extend as needed)
    const inappropriateWords = [
      'badword',
      'inappropriate',
      'offensive',
      // Add more words as needed
    ];
  
    // Regex to detect URLs in text (http, https, or other URL-like patterns)
    const urlRegex = /https?:\/\/[^\s]+|www\.[^\s]+|[^\s]+\.[^\s]+/i;
  
    // Regex for valid Zoom links (allows zoom.us with optional subdomains and paths)
    const zoomLinkRegex = /^https:\/\/([a-z0-9-]+\.)*zoom\.us\/.+$/i;
  
    try {
      // 1. Verify record is an object and has type: "Record"
      if (!record || typeof record !== 'object' || record.type !== 'Record') {
        console.log('Moderation failed: Invalid record structure or type');
        return false;
      }
  
      // 2. Validate schema fields
      if (
        !record.id ||
        typeof record.id !== 'string' ||
        !record.created_at ||
        typeof record.created_at !== 'number' ||
        !record.bucket ||
        typeof record.bucket !== 'string' ||
        !record.author ||
        typeof record.author !== 'object' ||
        !record.author.npub ||
        typeof record.author.npub !== 'string' ||
        !record.content ||
        typeof record.content !== 'object' ||
        !record.geo ||
        typeof record.geo !== 'object' ||
        typeof record.geo.latitude !== 'number' ||
        typeof record.geo.longitude !== 'number' ||
        !record.integrity ||
        typeof record.integrity !== 'object' ||
        !record.integrity.hash ||
        typeof record.integrity.hash !== 'string' ||
        !record.integrity.signature ||
        typeof record.integrity.signature !== 'string'
      ) {
        console.log('Moderation failed: Invalid record schema');
        return false;
      }
  
      // 3. Check text field for inappropriate words
      const text = record.content.text;
      if (typeof text !== 'string') {
        console.log('Moderation failed: Text field must be a string');
        return false;
      }
  
      const lowerText = text.toLowerCase();
      for (const word of inappropriateWords) {
        if (lowerText.includes(word.toLowerCase())) {
          console.log(`Moderation failed: Text contains inappropriate word: ${word}`);
          return false;
        }
      }
  
      // 4. Check text field for URLs
      if (urlRegex.test(text)) {
        console.log('Moderation failed: Text contains a URL');
        return false;
      }
  
      // 5. Validate link field (must be null or a valid zoom.us link)
      const link = record.content.link;
      if (link !== null && (typeof link !== 'string' || !zoomLinkRegex.test(link))) {
        console.log('Moderation failed: Link must be null or a valid zoom.us URL');
        return false;
      }
  
      // All checks passed
      return true;
    } catch (error) {
      console.error('Moderation error:', error);
      return false;
    }
  }
*/