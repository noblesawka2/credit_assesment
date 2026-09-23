import type { EncryptedStore, SealedRecord, UnlockAttemptStore } from "./vault.ts";
import { DomainError } from "../domain/validation.ts";
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("nobles-sealed-drafts", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("sealed")) request.result.createObjectStore("sealed");
      if (!request.result.objectStoreNames.contains("unlock-attempts")) request.result.createObjectStore("unlock-attempts");
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(new Error("ENCRYPTED_STORE_UNAVAILABLE"));
    request.onblocked = () => reject(new Error("ENCRYPTED_STORE_UPGRADE_BLOCKED"));
  });
}
export class IndexedEncryptedStore implements EncryptedStore {
  private readonly database: Promise<IDBDatabase>;
  constructor() {
    this.database = openDatabase();
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
export class IndexedUnlockAttempts implements UnlockAttemptStore {
  private readonly database = openDatabase();
  private async update(scope: string, succeededId?: string): Promise<string> {
    const database = await this.database;
    const attemptId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("unlock-attempts", "readwrite", { durability: "strict" });
      const store = transaction.objectStore("unlock-attempts");
      const request = store.get(scope);
      let failure = "UNLOCK_CONTROL_UNAVAILABLE";
      request.onsuccess = () => {
        const entries: unknown = request.result ?? [];
        if (!Array.isArray(entries) || entries.some(entry => typeof entry !== "string")) { transaction.abort(); return; }
        if (succeededId) {
          if (!entries.includes(succeededId)) { transaction.abort(); return; }
          store.put(entries.filter(entry => entry !== succeededId), scope);
        } else {
          if (entries.length >= 5) { failure = "OFFLINE_UNLOCK_LOCKED"; transaction.abort(); return; }
          store.put([...entries, attemptId], scope);
        }
      };
      transaction.oncomplete = () => resolve(attemptId);
      transaction.onabort = () => reject(new DomainError(failure));
      transaction.onerror = () => reject(new DomainError(failure));
    });
  }
  async reserve(scope: string) { return this.update(scope); }
  async succeeded(scope: string, attemptId: string) { await this.update(scope, attemptId); }
}
