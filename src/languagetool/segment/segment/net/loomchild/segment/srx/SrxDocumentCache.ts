// SPDX-License-Identifier: MPL-2.0
// @upstream segment/src/main/java/net/loomchild/segment/srx/SrxDocumentCache.java faithful
// A Map in place of the ConcurrentHashMap: JavaScript runs one thread per realm.

/**
 * Represents SRX document cache.
 * Responsible for managing cached data.
 * 
 * @author loomchild
 */
export class SrxDocumentCache {
	
	private map: Map<string, unknown>;
	
	constructor() {
		this.map = new Map<string, unknown>();
	}
	
	/**
	 * Retrieves object from cache. 
	 * @param key
	 * @return value object
	 */
	get(key: string): unknown {
		const value = this.map.get(key);
		return value;
	}

	/**
	 * Puts an object in cache.
	 * @param key
	 * @param value value object
	 */
	put(key: string, value: unknown): void {
		this.map.set(key, value);
	}
	
}
