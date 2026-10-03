/** Exact bytes only. Different views/positions/categories supply their own checksum sets. */
export async function uniqueEvidenceFiles(files: File[], existing: Iterable<string>) {
  if (!globalThis.crypto?.subtle) return { files, skipped: 0 }; // server deduplication remains authoritative
  const seen = new Set(existing);
  const unique: File[] = [];
  for (const file of files) {
    const bytes = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const checksum = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
    if (seen.has(checksum)) continue;
    seen.add(checksum); unique.push(file);
  }
  return { files: unique, skipped: files.length - unique.length };
}
