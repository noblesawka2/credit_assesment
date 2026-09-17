import type { EncryptedStore, SealedRecord } from "./vault.ts";
export class IndexedEncryptedStore implements EncryptedStore {
  private readonly database: Promise<IDBDatabase>;
  constructor() {
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open("nobles-sealed-drafts", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("sealed");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("ENCRYPTED_STORE_UNAVAILABLE"));
    });
  }
  private async operation<T>(mode: IDBTransactionMode, execute: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const database = await this.database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("sealed", mode);
      const request = execute(transaction.objectStore("sealed"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(new Error("ENCRYPTED_STORE_ABORTED"));
      transaction.onerror = () => reject(new Error("ENCRYPTED_STORE_FAILED"));
    });
  }
  async put(id: string, record: SealedRecord) {
    await this.operation("readwrite", store => store.put(record, id));
  }
  async get(id: string) {
    return await this.operation<SealedRecord | undefined>("readonly", store => store.get(id));
  }
  async delete(id: string) { await this.operation("readwrite", store => store.delete(id)); }
}
